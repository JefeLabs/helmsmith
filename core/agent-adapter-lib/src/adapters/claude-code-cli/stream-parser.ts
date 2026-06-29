/**
 * Line-buffered stream-json parser for the `claude` CLI (Phase C).
 *
 * Maps the REAL claude-code stream-json events (captured from v2.1.195) into
 * the normalized AgentChunk union. Observed line shapes:
 *
 *   {"type":"system","subtype":"init"|"hook_started"|...}        → skipped
 *   {"type":"rate_limit_event", ...}                              → skipped
 *   {"type":"stream_event", ...}                                  → skipped (partial-message frames)
 *   {"type":"assistant","message":{content:[ ... ]}, ...}        → per content block:
 *        {"type":"text","text":"..."}             → text-delta
 *        {"type":"thinking","thinking":"..."}     → thinking-delta
 *        {"type":"tool_use","id","name","input"}  → tool-call-start + tool-call-input + tool-call-end
 *   {"type":"user","message":{content:[{type:"tool_result", tool_use_id, content}]}}
 *                                                  → tool-result (observability)
 *   {"type":"result","subtype":"success","is_error":bool,"result","stop_reason","usage"}
 *        success           → usage (if present) + message-stop
 *        is_error / "error" → usage (if present) + error
 *   {"type":"error", ...}                                         → error
 *
 * Two ingestion modes:
 *   - pushLine(line):  one COMPLETE JSON object (no trailing newline). The
 *     adapter uses this — spawnAgentProcess already splits stdout on '\n'.
 *   - push(raw):       arbitrary text that may split a line across chunks; the
 *     parser buffers internally and emits per complete '\n'-terminated line.
 *   - flush():         emit any trailing buffered (unterminated) line.
 *
 * Errors are classified into AdapterError subclasses so consumers can branch on
 * `instanceof` (AuthError for "not logged in", etc.).
 */

import type { AgentInvocationResult, Logger, TokenUsage } from '../../agent.ts';
import type { AdapterError } from '../../errors.ts';
import { AuthError, BillingError, ProviderError, RateLimitError } from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';

// ---------------------------------------------------------------------------
// Raw stream-json line shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface RawContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface RawAssistantLine {
  type: 'assistant';
  message: { content?: RawContentBlock[] };
}

interface RawUserLine {
  type: 'user';
  message: { content?: RawContentBlock[] | string };
}

interface RawResultLine {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  api_error_status?: unknown;
  usage?: RawUsage;
}

interface RawErrorLine {
  type: 'error';
  message?: string;
  error?: { message?: string } | string;
}

type RawLine =
  | RawAssistantLine
  | RawUserLine
  | RawResultLine
  | RawErrorLine
  | { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// ClaudeStreamParser
// ---------------------------------------------------------------------------

export interface ClaudeStreamParserOptions {
  logger?: Logger;
}

export class ClaudeStreamParser {
  private buffer = '';
  private readonly logger?: Logger;

  constructor(opts?: ClaudeStreamParserOptions) {
    this.logger = opts?.logger;
  }

  /**
   * Ingest arbitrary text (possibly splitting a line across chunks). Buffers
   * internally and returns chunks for every complete '\n'-terminated line.
   */
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
      // Non-JSON noise on stdout — log and skip rather than crash the stream.
      this.logger?.warn?.(
        `[claude-code-cli] skipping non-JSON stdout line: ${trimmed.slice(0, 120)}`,
      );
      return [];
    }

    switch (obj.type) {
      case 'assistant':
        return this.handleAssistant(obj as RawAssistantLine);
      case 'user':
        return this.handleUser(obj as RawUserLine);
      case 'result':
        return this.handleResult(obj as RawResultLine);
      case 'error':
        return [{ type: 'error', error: this.classifyErrorLine(obj as RawErrorLine) }];
      default:
        // system, rate_limit_event, stream_event, control_* — observability only.
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Per-line handlers
  // -------------------------------------------------------------------------

  private handleAssistant(line: RawAssistantLine): AgentChunk[] {
    const out: AgentChunk[] = [];
    const blocks = line.message?.content ?? [];
    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          if (block.text) out.push({ type: 'text-delta', text: block.text });
          break;
        case 'thinking':
          if (block.thinking) out.push({ type: 'thinking-delta', text: block.thinking });
          break;
        case 'tool_use': {
          const toolCallId = block.id ?? '';
          const toolName = block.name ?? '';
          out.push({ type: 'tool-call-start', toolCallId, toolName });
          // Built-in tool calls arrive with the full input already resolved
          // (no incremental input_json_delta in default mode); surface it as a
          // single partial-input frame plus the resolved end frame so the
          // chunk contract matches the streaming SDK adapters.
          const partialInput =
            typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {});
          out.push({ type: 'tool-call-input', toolCallId, partialInput });
          out.push({ type: 'tool-call-end', toolCallId, input: block.input ?? {} });
          break;
        }
        default:
          // redacted_thinking, server_tool_use, etc. — skipped.
          break;
      }
    }
    return out;
  }

  private handleUser(line: RawUserLine): AgentChunk[] {
    const content = line.message?.content;
    if (!Array.isArray(content)) return [];
    const out: AgentChunk[] = [];
    for (const block of content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        out.push({ type: 'tool-result', toolCallId: block.tool_use_id, output: block.content });
      }
    }
    return out;
  }

  private handleResult(line: RawResultLine): AgentChunk[] {
    const out: AgentChunk[] = [];
    if (line.usage) {
      const usage = mapUsage(line.usage);
      if (usage) out.push({ type: 'usage', usage });
    }

    const isError = line.is_error === true || line.subtype === 'error';
    if (isError) {
      out.push({ type: 'error', error: this.classifyResultError(line) });
      return out;
    }

    out.push({ type: 'message-stop', finishReason: mapStopReason(line.stop_reason) });
    return out;
  }

  // -------------------------------------------------------------------------
  // Error classification
  // -------------------------------------------------------------------------

  private classifyResultError(line: RawResultLine): AdapterError {
    const message =
      (typeof line.result === 'string' && line.result) ||
      `claude exited with an error result (subtype: ${line.subtype ?? 'unknown'})`;
    return classifyClaudeError(message);
  }

  private classifyErrorLine(line: RawErrorLine): AdapterError {
    const message =
      line.message ??
      (typeof line.error === 'string' ? line.error : line.error?.message) ??
      'claude emitted an error event';
    return classifyClaudeError(message);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Map a claude-code result.usage block into the normalized TokenUsage. */
export function mapUsage(u: RawUsage | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  const usage: TokenUsage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
  if (u.cache_read_input_tokens !== undefined) usage.cacheReadTokens = u.cache_read_input_tokens;
  if (u.cache_creation_input_tokens !== undefined) {
    usage.cacheWriteTokens = u.cache_creation_input_tokens;
  }
  return usage;
}

/** Map a claude stop_reason to the normalized finishReason. */
export function mapStopReason(
  stopReason: string | null | undefined,
): AgentInvocationResult['finishReason'] {
  switch (stopReason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
    case 'refusal':
      return 'content_filter';
    default:
      return 'stop';
  }
}

/**
 * Classify a claude error message string into an AdapterError subclass so
 * consumers can `instanceof`-branch. Mirrors the HTTP classifier's buckets but
 * works from the CLI's human-readable result text.
 */
export function classifyClaudeError(message: string): AdapterError {
  const lower = message.toLowerCase();
  if (
    lower.includes('not logged in') ||
    lower.includes('/login') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key')
  ) {
    return new AuthError(`claude-code-cli: ${message}`);
  }
  if (
    lower.includes('credit') ||
    lower.includes('balance') ||
    lower.includes('quota') ||
    lower.includes('out of credits')
  ) {
    return new BillingError(`claude-code-cli: ${message}`);
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return new RateLimitError(`claude-code-cli: ${message}`);
  }
  return new ProviderError(`claude-code-cli: ${message}`);
}
