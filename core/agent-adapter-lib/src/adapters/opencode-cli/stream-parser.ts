/**
 * Line-buffered NDJSON parser for the `opencode` CLI (Phase D).
 *
 * Maps the REAL opencode `run --format json` event stream (captured from
 * v1.17.5) into the normalized AgentChunk union. Unlike claude-code's
 * stream-json, opencode emits ONE consolidated event per "part" (not
 * incremental deltas): each `text`/`reasoning` event already carries the
 * complete text, and each `tool_use` event carries the resolved tool state.
 *
 * Observed top-level line shapes (each a single NDJSON object):
 *
 *   {"type":"step_start","part":{"type":"step-start", ...}}        → skipped
 *   {"type":"text","part":{"type":"text","text":"...", ...}}       → text-delta (full text)
 *   {"type":"reasoning","part":{"type":"reasoning","text":"...",}} → thinking-delta (skip empty)
 *   {"type":"tool_use","part":{"type":"tool","tool":"<name>",
 *        "callID":"<id>","state":{"status":"completed","input":{},
 *        "output":"..."}}}                                          → tool-call-start
 *                                                                     + tool-call-input
 *                                                                     + tool-call-end
 *                                                                     + tool-result
 *   {"type":"step_finish","part":{"type":"step-finish",
 *        "reason":"stop"|"tool-calls"|"length"|...,
 *        "tokens":{"input","output","reasoning","cache":{"read","write"}}}}
 *        reason === 'tool-calls'  → intermediate step: accumulate tokens, no terminal
 *        any other reason         → terminal: emit cumulative usage + message-stop
 *   {"type":"error","error":{"name":"APIError","data":{"message",
 *        "statusCode":402, ...}}}                                   → error
 *
 * Usage note: opencode reports tokens PER STEP (not cumulative across steps),
 * so a multi-step (tool-using) turn yields several step_finish events. We
 * accumulate the per-step token counts internally and emit a SINGLE cumulative
 * `usage` chunk at the terminal step (reduceStream overwrites usage, so one
 * cumulative chunk is the only way to report the true total).
 *
 * Errors are classified into AdapterError subclasses (AuthError for 401,
 * BillingError for 402, ConfigError for model-not-found, etc.) so consumers
 * can `instanceof`-branch.
 *
 * Two ingestion modes mirror the claude parser:
 *   - pushLine(line):  one COMPLETE JSON object (no trailing newline). The
 *     adapter uses this — spawnAgentProcess already splits stdout on '\n'.
 *   - push(raw):       arbitrary text that may split a line across chunks.
 *   - flush():         emit any trailing buffered usage / unterminated line.
 */

import type { AgentInvocationResult, Logger, TokenUsage } from '../../agent.ts';
import type { AdapterError } from '../../errors.ts';
import {
  AuthError,
  BillingError,
  ConfigError,
  classifyHttpError,
  ProviderError,
  RateLimitError,
} from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';

// ---------------------------------------------------------------------------
// Raw opencode --format json line shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface RawTokens {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

interface RawToolState {
  status?: string;
  input?: unknown;
  output?: unknown;
}

interface RawPart {
  type?: string;
  text?: string;
  // tool_use parts
  tool?: string;
  callID?: string;
  state?: RawToolState;
  // step_finish parts
  reason?: string;
  tokens?: RawTokens;
}

interface RawErrorData {
  message?: string;
  statusCode?: number;
  ref?: string;
}

interface RawLine {
  type?: string;
  part?: RawPart;
  error?: { name?: string; data?: RawErrorData };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// OpencodeStreamParser
// ---------------------------------------------------------------------------

export interface OpencodeStreamParserOptions {
  logger?: Logger;
}

export class OpencodeStreamParser {
  private buffer = '';
  private readonly logger?: Logger;
  /** Accumulated per-step token counts (opencode reports per step, not total). */
  private readonly usageAcc: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  private sawUsage = false;
  private usageEmitted = false;
  /** Guards against double-emitting a tool sequence for the same callID. */
  private readonly emittedToolCalls = new Set<string>();

  constructor(opts?: OpencodeStreamParserOptions) {
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

  /**
   * Flush a trailing unterminated line, then emit any accumulated-but-unsent
   * usage (e.g. the process ended on a non-terminal step or was cut off). The
   * adapter still owns the terminal message-stop in that case.
   */
  flush(): AgentChunk[] {
    const out: AgentChunk[] = [];
    if (this.buffer.length > 0) {
      const line = this.buffer;
      this.buffer = '';
      out.push(...this.pushLine(line));
    }
    if (this.sawUsage && !this.usageEmitted) {
      this.usageEmitted = true;
      out.push({ type: 'usage', usage: { ...this.usageAcc } });
    }
    return out;
  }

  /** Parse exactly one complete NDJSON line (no trailing newline). */
  pushLine(line: string): AgentChunk[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];

    let obj: RawLine;
    try {
      obj = JSON.parse(trimmed) as RawLine;
    } catch {
      // opencode also prints pino-style log lines (`[12:00:00.000] ERROR ...`)
      // to stdout in some failure paths — skip non-JSON noise rather than crash.
      this.logger?.warn?.(`[opencode-cli] skipping non-JSON stdout line: ${trimmed.slice(0, 120)}`);
      return [];
    }

    switch (obj.type) {
      case 'text':
        return this.handleText(obj.part);
      case 'reasoning':
        return this.handleReasoning(obj.part);
      case 'tool_use':
        return this.handleToolUse(obj.part);
      case 'step_finish':
        return this.handleStepFinish(obj.part);
      case 'error':
        return [{ type: 'error', error: this.classifyErrorEvent(obj) }];
      default:
        // step_start, step (intermediate part snapshots), file, snapshot, etc.
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Per-event handlers
  // -------------------------------------------------------------------------

  private handleText(part: RawPart | undefined): AgentChunk[] {
    const text = part?.text;
    if (typeof text === 'string' && text.length > 0) {
      return [{ type: 'text-delta', text }];
    }
    return [];
  }

  private handleReasoning(part: RawPart | undefined): AgentChunk[] {
    const text = part?.text;
    if (typeof text === 'string' && text.length > 0) {
      return [{ type: 'thinking-delta', text }];
    }
    return [];
  }

  private handleToolUse(part: RawPart | undefined): AgentChunk[] {
    if (!part) return [];
    const toolCallId = part.callID ?? '';
    const toolName = part.tool ?? '';
    const state = part.state ?? {};
    // Only surface a completed/errored tool part once. With --format json the
    // part arrives once already-resolved; the guard is belt-and-suspenders for
    // any intermediate (running) snapshots a future opencode build might emit.
    if (toolCallId && this.emittedToolCalls.has(toolCallId)) return [];
    if (state.status !== undefined && state.status !== 'completed' && state.status !== 'error') {
      return [];
    }
    if (toolCallId) this.emittedToolCalls.add(toolCallId);

    const input = state.input ?? {};
    const out: AgentChunk[] = [
      { type: 'tool-call-start', toolCallId, toolName },
      {
        type: 'tool-call-input',
        toolCallId,
        partialInput: typeof input === 'string' ? input : JSON.stringify(input),
      },
      { type: 'tool-call-end', toolCallId, input },
    ];
    if (state.output !== undefined) {
      out.push({ type: 'tool-result', toolCallId, output: state.output });
    }
    return out;
  }

  private handleStepFinish(part: RawPart | undefined): AgentChunk[] {
    if (!part) return [];
    if (part.tokens) this.accumulateUsage(part.tokens);

    // 'tool-calls' marks an intermediate step (more steps follow); only a
    // genuinely terminal reason ends the turn.
    if (isContinuationReason(part.reason)) return [];

    const out: AgentChunk[] = [];
    if (this.sawUsage && !this.usageEmitted) {
      this.usageEmitted = true;
      out.push({ type: 'usage', usage: { ...this.usageAcc } });
    }
    out.push({ type: 'message-stop', finishReason: mapStopReason(part.reason) });
    return out;
  }

  private accumulateUsage(tokens: RawTokens): void {
    this.sawUsage = true;
    this.usageAcc.inputTokens += tokens.input ?? 0;
    this.usageAcc.outputTokens += tokens.output ?? 0;
    const cacheRead = tokens.cache?.read;
    if (cacheRead !== undefined) {
      this.usageAcc.cacheReadTokens = (this.usageAcc.cacheReadTokens ?? 0) + cacheRead;
    }
    const cacheWrite = tokens.cache?.write;
    if (cacheWrite !== undefined) {
      this.usageAcc.cacheWriteTokens = (this.usageAcc.cacheWriteTokens ?? 0) + cacheWrite;
    }
  }

  private classifyErrorEvent(obj: RawLine): AdapterError {
    const name = obj.error?.name;
    const data = obj.error?.data;
    return classifyOpencodeError(name, data);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** opencode signals "more steps follow" with the AI-SDK `tool-calls` reason. */
export function isContinuationReason(reason: string | undefined): boolean {
  return reason === 'tool-calls' || reason === 'tool_calls';
}

/** Map an opencode step-finish reason to the normalized finishReason. */
export function mapStopReason(
  reason: string | null | undefined,
): AgentInvocationResult['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
    case 'max-tokens':
    case 'max_tokens':
      return 'length';
    case 'tool-calls':
    case 'tool_calls':
      return 'tool_use';
    case 'content-filter':
    case 'content_filter':
      return 'content_filter';
    case 'aborted':
    case 'abort':
    case 'cancel':
    case 'cancelled':
      return 'aborted';
    case 'error':
      return 'error';
    default:
      return 'stop';
  }
}

/** Map an opencode step `tokens` block into the normalized TokenUsage. */
export function mapTokens(t: RawTokens | undefined): TokenUsage | undefined {
  if (!t) return undefined;
  const usage: TokenUsage = {
    inputTokens: t.input ?? 0,
    outputTokens: t.output ?? 0,
  };
  if (t.cache?.read !== undefined) usage.cacheReadTokens = t.cache.read;
  if (t.cache?.write !== undefined) usage.cacheWriteTokens = t.cache.write;
  return usage;
}

/**
 * Classify an opencode error event into an AdapterError subclass.
 *
 * Prefers the HTTP statusCode when present (reusing classifyHttpError's
 * buckets), then the structured error `name` (e.g. ProviderModelNotFoundError
 * → ConfigError), then the human-readable message string.
 */
export function classifyOpencodeError(
  name: string | undefined,
  data: RawErrorData | undefined,
): AdapterError {
  const message = data?.message ?? name ?? 'opencode emitted an error event';
  const prefixed = `opencode-cli: ${message}`;

  if (typeof data?.statusCode === 'number') {
    return classifyHttpError({
      status: data.statusCode,
      body: message,
      context: 'opencode-cli',
    });
  }

  if (name && /ModelNotFound|ProviderNotFound|UnknownProvider/i.test(name)) {
    return new ConfigError(prefixed);
  }

  return classifyOpencodeMessage(prefixed);
}

/**
 * Classify a free-text opencode error message into an AdapterError subclass.
 * Mirrors the claude classifier's buckets but works from opencode's strings.
 */
export function classifyOpencodeMessage(message: string): AdapterError {
  const lower = message.toLowerCase();
  if (
    lower.includes('not logged in') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('401')
  ) {
    return new AuthError(message);
  }
  if (
    lower.includes('payment required') ||
    lower.includes('credit') ||
    lower.includes('balance') ||
    lower.includes('quota') ||
    lower.includes('deactivated') ||
    lower.includes('402')
  ) {
    return new BillingError(message);
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many requests')
  ) {
    return new RateLimitError(message);
  }
  if (
    lower.includes('modelnotfound') ||
    lower.includes('model not found') ||
    lower.includes('not_found') ||
    lower.includes('does not exist')
  ) {
    return new ConfigError(message);
  }
  return new ProviderError(message);
}
