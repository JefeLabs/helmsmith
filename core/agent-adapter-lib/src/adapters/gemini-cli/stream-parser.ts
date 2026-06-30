/**
 * Line-buffered stream-json parser for the `gemini` CLI (Phase D‴).
 *
 * Maps the REAL gemini stream-json events into the normalized AgentChunk union.
 * The event schema is verified against @google/gemini-cli-core's
 * JsonStreamEventType (the v0.43.0 bundle emits the same `init | message |
 * tool_use | tool_result | error | result` event types; field shapes from the
 * core `output/types.ts` declarations):
 *
 *   {"type":"init","timestamp","session_id","model"}            → skipped (observability)
 *   {"type":"message","timestamp","role":"user"|"assistant","content":string,"delta"?:bool}
 *        role:"assistant" → text-delta(content)   (role:"user" echoes input → skipped)
 *   {"type":"tool_use","timestamp","tool_name","tool_id","parameters":{}}
 *        → tool-call-start + tool-call-input + tool-call-end
 *   {"type":"tool_result","timestamp","tool_id","status":"success"|"error","output"?,"error"?}
 *        → tool-result (observability)
 *   {"type":"error","timestamp","severity":"warning"|"error","message"}
 *        severity:"error" → error chunk;  "warning" → skipped (logged)
 *   {"type":"result","timestamp","status":"success"|"error","error"?,"stats"?}
 *        stats → usage; success → message-stop('stop'); error → error chunk
 *
 * Ingestion mirrors the claude-code-cli parser:
 *   - pushLine(line): one COMPLETE JSON object (the adapter uses this — stdout
 *     is already newline-split by spawnAgentProcess).
 *   - push(raw):      arbitrary text; buffers + emits per complete '\n' line.
 *   - flush():        emit any trailing unterminated line.
 *
 * Assistant text: gemini streams either incremental `delta:true` message events
 * OR a single full message. To avoid double-counting a trailing aggregate that
 * some builds emit AFTER the deltas, once a `delta:true` event is seen, a later
 * non-delta assistant message in the same stream is treated as the aggregate
 * and skipped.
 */

import type { AgentInvocationResult, Logger, TokenUsage } from '../../agent.ts';
import type { AdapterError } from '../../errors.ts';
import { AuthError, BillingError, ProviderError, RateLimitError } from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';

// ---------------------------------------------------------------------------
// Raw stream-json line shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface RawStats {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
  tool_calls?: number;
}

interface RawMessageLine {
  type: 'message';
  role?: 'user' | 'assistant' | string;
  content?: string;
  delta?: boolean;
}

interface RawToolUseLine {
  type: 'tool_use';
  tool_name?: string;
  tool_id?: string;
  parameters?: Record<string, unknown>;
}

interface RawToolResultLine {
  type: 'tool_result';
  tool_id?: string;
  status?: 'success' | 'error' | string;
  output?: string;
  error?: { type?: string; message?: string };
}

interface RawErrorLine {
  type: 'error';
  severity?: 'warning' | 'error' | string;
  message?: string;
}

interface RawResultLine {
  type: 'result';
  status?: 'success' | 'error' | string;
  error?: { type?: string; message?: string };
  stats?: RawStats;
}

type RawLine =
  | RawMessageLine
  | RawToolUseLine
  | RawToolResultLine
  | RawErrorLine
  | RawResultLine
  | { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// GeminiStreamParser
// ---------------------------------------------------------------------------

export interface GeminiStreamParserOptions {
  logger?: Logger;
}

export class GeminiStreamParser {
  private buffer = '';
  private sawDelta = false;
  private readonly logger?: Logger;

  constructor(opts?: GeminiStreamParserOptions) {
    this.logger = opts?.logger;
  }

  /** Ingest arbitrary text; emit chunks for every complete '\n'-terminated line. */
  push(raw: string): AgentChunk[] {
    this.buffer += raw;
    const out: AgentChunk[] = [];
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      out.push(...this.pushLine(line));
      nl = this.buffer.indexOf('\n');
    }
    return out;
  }

  /** Flush a trailing line that was never newline-terminated. */
  flush(): AgentChunk[] {
    if (this.buffer.length === 0) return [];
    const line = this.buffer;
    this.buffer = '';
    return this.pushLine(line);
  }

  /** Parse exactly one complete stream-json line (no trailing newline). */
  pushLine(line: string): AgentChunk[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];

    let obj: RawLine;
    try {
      obj = JSON.parse(trimmed) as RawLine;
    } catch {
      this.logger?.warn?.(`[gemini-cli] skipping non-JSON stdout line: ${trimmed.slice(0, 120)}`);
      return [];
    }

    switch (obj.type) {
      case 'message':
        return this.handleMessage(obj as RawMessageLine);
      case 'tool_use':
        return this.handleToolUse(obj as RawToolUseLine);
      case 'tool_result':
        return this.handleToolResult(obj as RawToolResultLine);
      case 'error':
        return this.handleError(obj as RawErrorLine);
      case 'result':
        return this.handleResult(obj as RawResultLine);
      default:
        // init + any future observability-only frames.
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Per-line handlers
  // -------------------------------------------------------------------------

  private handleMessage(line: RawMessageLine): AgentChunk[] {
    if (line.role !== 'assistant') return []; // user echoes are skipped
    const text = line.content ?? '';
    if (text.length === 0) return [];
    if (line.delta === true) {
      this.sawDelta = true;
      return [{ type: 'text-delta', text }];
    }
    // Non-delta full message AFTER deltas → trailing aggregate; skip it.
    if (this.sawDelta) return [];
    return [{ type: 'text-delta', text }];
  }

  private handleToolUse(line: RawToolUseLine): AgentChunk[] {
    const toolCallId = line.tool_id ?? '';
    const toolName = line.tool_name ?? '';
    const input = line.parameters ?? {};
    return [
      { type: 'tool-call-start', toolCallId, toolName },
      { type: 'tool-call-input', toolCallId, partialInput: JSON.stringify(input) },
      { type: 'tool-call-end', toolCallId, input },
    ];
  }

  private handleToolResult(line: RawToolResultLine): AgentChunk[] {
    const toolCallId = line.tool_id ?? '';
    const output =
      line.status === 'error' ? (line.error ?? { message: 'tool error' }) : line.output;
    return [{ type: 'tool-result', toolCallId, output }];
  }

  private handleError(line: RawErrorLine): AgentChunk[] {
    const message = line.message ?? 'gemini emitted an error event';
    if (line.severity === 'warning') {
      // Non-terminal — e.g. "Loop detected, stopping execution".
      this.logger?.warn?.(`[gemini-cli] warning: ${message}`);
      return [];
    }
    return [{ type: 'error', error: classifyGeminiError(message) }];
  }

  private handleResult(line: RawResultLine): AgentChunk[] {
    const out: AgentChunk[] = [];
    const usage = mapGeminiUsage(line.stats);
    if (usage) out.push({ type: 'usage', usage });

    if (line.status === 'error') {
      const message =
        (line.error && typeof line.error.message === 'string' && line.error.message) ||
        'gemini exited with an error result';
      out.push({ type: 'error', error: classifyGeminiError(message) });
      return out;
    }

    out.push({ type: 'message-stop', finishReason: 'stop' });
    return out;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Map a gemini result.stats block into the normalized TokenUsage. */
export function mapGeminiUsage(stats: RawStats | undefined): TokenUsage | undefined {
  if (!stats) return undefined;
  if (stats.input_tokens === undefined && stats.output_tokens === undefined) return undefined;
  return {
    inputTokens: stats.input_tokens ?? 0,
    outputTokens: stats.output_tokens ?? 0,
  };
}

/**
 * Classify a gemini error message string into an AdapterError subclass so
 * consumers can `instanceof`-branch.
 */
export function classifyGeminiError(message: string): AdapterError {
  const lower = message.toLowerCase();
  if (
    lower.includes('unauthenticated') ||
    lower.includes('unauthorized') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid api key') ||
    lower.includes('permission denied') ||
    lower.includes('login') ||
    lower.includes('credential')
  ) {
    return new AuthError(`gemini-cli: ${message}`);
  }
  if (
    lower.includes('quota') ||
    lower.includes('billing') ||
    lower.includes('insufficient') ||
    lower.includes('credit')
  ) {
    return new BillingError(`gemini-cli: ${message}`);
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted') ||
    lower.includes('429')
  ) {
    return new RateLimitError(`gemini-cli: ${message}`);
  }
  return new ProviderError(`gemini-cli: ${message}`);
}

/** Map a finish/result outcome to the normalized finishReason. */
export function mapGeminiFinishReason(
  status: string | undefined,
): AgentInvocationResult['finishReason'] {
  return status === 'error' ? 'error' : 'stop';
}
