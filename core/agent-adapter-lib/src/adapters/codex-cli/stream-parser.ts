/**
 * Line-buffered JSONL parser for `codex exec --json` (Phase D‴).
 *
 * Maps the REAL codex thread-event stream into the normalized AgentChunk union.
 * The event envelope is verified live (codex v0.133.0 — thread.started /
 * turn.started / error / turn.failed captured in fixtures/error-402.jsonl) and
 * the item/usage shapes are verified against the codex 0.133.0 binary's serde
 * enums (ThreadItem variants agent_message/reasoning/command_execution/
 * file_change/mcp_tool_call/web_search; TokenUsage input_tokens/output_tokens/
 * cached_input_tokens) and the published `codex exec --json` parser:
 *
 *   {"type":"thread.started","thread_id":"..."}                  → skipped
 *   {"type":"turn.started"}                                      → skipped
 *   {"type":"item.started"|"item.updated", ...}                  → skipped
 *   {"type":"item.completed","item":{ "id", "item_type"|"type", "text"?, ... }}
 *        agent_message/assistant_message (text) → text-delta
 *        reasoning (text)                       → thinking-delta
 *        command_execution/file_change/mcp_tool_call/web_search →
 *            tool-call-start + tool-call-input + tool-call-end + tool-result
 *   {"type":"turn.completed","usage":{input_tokens,output_tokens,cached_input_tokens}}
 *        → usage + message-stop('stop')
 *   {"type":"turn.failed","error":{"message"}}                   → error chunk
 *   {"type":"error","message":"..."}                             → error chunk
 *
 * Ingestion mirrors the claude-code-cli parser: pushLine (one complete object),
 * push (buffers arbitrary text), flush (trailing line).
 */

import type { Logger, TokenUsage } from '../../agent.ts';
import type { AdapterError } from '../../errors.ts';
import { AuthError, BillingError, ProviderError, RateLimitError } from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';

// ---------------------------------------------------------------------------
// Raw event shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
}

interface RawItem {
  id?: string;
  item_type?: string;
  type?: string;
  text?: string;
  // tool-ish fields (command_execution / file_change / mcp_tool_call / web_search)
  command?: string;
  status?: string;
  cwd?: string;
  exit_code?: number;
  aggregated_output?: string;
  changes?: unknown;
  server?: string;
  tool?: string;
  arguments?: unknown;
  query?: string;
  [key: string]: unknown;
}

interface RawEvent {
  type: string;
  thread_id?: string;
  item?: RawItem;
  usage?: RawUsage;
  error?: { message?: string };
  message?: string;
}

const ASSISTANT_ITEM_TYPES = new Set(['agent_message', 'assistant_message']);
const TOOL_ITEM_TYPES = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'web_search',
]);

// ---------------------------------------------------------------------------
// CodexStreamParser
// ---------------------------------------------------------------------------

export interface CodexStreamParserOptions {
  logger?: Logger;
}

export class CodexStreamParser {
  private buffer = '';
  private readonly logger?: Logger;

  constructor(opts?: CodexStreamParserOptions) {
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

  /** Parse exactly one complete JSONL event line (no trailing newline). */
  pushLine(line: string): AgentChunk[] {
    const trimmed = line.trim();
    if (trimmed.length === 0) return [];

    let evt: RawEvent;
    try {
      evt = JSON.parse(trimmed) as RawEvent;
    } catch {
      this.logger?.warn?.(`[codex-cli] skipping non-JSON stdout line: ${trimmed.slice(0, 120)}`);
      return [];
    }

    switch (evt.type) {
      case 'item.completed':
        return this.handleItemCompleted(evt);
      case 'turn.completed':
        return this.handleTurnCompleted(evt);
      case 'turn.failed':
        return [{ type: 'error', error: this.classifyEventError(evt) }];
      case 'error':
        return [{ type: 'error', error: this.classifyEventError(evt) }];
      default:
        // thread.started, turn.started, item.started/updated, etc.
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Per-event handlers
  // -------------------------------------------------------------------------

  private handleItemCompleted(evt: RawEvent): AgentChunk[] {
    const item = evt.item;
    if (!item) return [];
    const itemType = getItemType(item);
    if (itemType === undefined) return [];

    if (ASSISTANT_ITEM_TYPES.has(itemType)) {
      return item.text ? [{ type: 'text-delta', text: item.text }] : [];
    }
    if (itemType === 'reasoning') {
      return item.text ? [{ type: 'thinking-delta', text: item.text }] : [];
    }
    if (TOOL_ITEM_TYPES.has(itemType)) {
      const toolCallId = item.id ?? '';
      const toolName = getToolName(itemType);
      const input = buildToolInput(itemType, item);
      return [
        { type: 'tool-call-start', toolCallId, toolName },
        { type: 'tool-call-input', toolCallId, partialInput: JSON.stringify(input) },
        { type: 'tool-call-end', toolCallId, input },
        { type: 'tool-result', toolCallId, output: buildToolResult(itemType, item) },
      ];
    }
    // user_message / todo_list / image / etc. — observability only.
    return [];
  }

  private handleTurnCompleted(evt: RawEvent): AgentChunk[] {
    const out: AgentChunk[] = [];
    const usage = mapCodexUsage(evt.usage);
    if (usage) out.push({ type: 'usage', usage });
    out.push({ type: 'message-stop', finishReason: 'stop' });
    return out;
  }

  private classifyEventError(evt: RawEvent): AdapterError {
    const message =
      (evt.error && typeof evt.error.message === 'string' && evt.error.message) ||
      (typeof evt.message === 'string' ? evt.message : undefined) ||
      'codex turn failed';
    return classifyCodexError(message);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** Item discriminator: prefer `item_type` (legacy), fall back to `type`. */
export function getItemType(item: RawItem): string | undefined {
  if (typeof item.item_type === 'string') return item.item_type;
  if (typeof item.type === 'string') return item.type;
  return undefined;
}

/** Map a codex tool item type to a stable tool name. */
export function getToolName(itemType: string): string {
  switch (itemType) {
    case 'command_execution':
      return 'exec';
    case 'file_change':
      return 'patch';
    case 'mcp_tool_call':
      return 'mcp_tool';
    case 'web_search':
      return 'web_search';
    default:
      return itemType;
  }
}

function buildToolInput(itemType: string, item: RawItem): Record<string, unknown> {
  switch (itemType) {
    case 'command_execution': {
      const p: Record<string, unknown> = {};
      if (typeof item.command === 'string') p.command = item.command;
      if (typeof item.cwd === 'string') p.cwd = item.cwd;
      return p;
    }
    case 'file_change':
      return item.changes !== undefined ? { changes: item.changes } : {};
    case 'mcp_tool_call': {
      const p: Record<string, unknown> = {};
      if (typeof item.server === 'string') p.server = item.server;
      if (typeof item.tool === 'string') p.tool = item.tool;
      if (item.arguments !== undefined) p.arguments = item.arguments;
      return p;
    }
    case 'web_search':
      return typeof item.query === 'string' ? { query: item.query } : {};
    default:
      return {};
  }
}

function buildToolResult(itemType: string, item: RawItem): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof item.status === 'string') out.status = item.status;
  if (itemType === 'command_execution') {
    if (typeof item.aggregated_output === 'string') out.aggregatedOutput = item.aggregated_output;
    if (typeof item.exit_code === 'number') out.exitCode = item.exit_code;
  }
  if (itemType === 'file_change' && item.changes !== undefined) out.changes = item.changes;
  return out;
}

/** Map a codex turn.completed usage block into the normalized TokenUsage. */
export function mapCodexUsage(u: RawUsage | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  if (u.input_tokens === undefined && u.output_tokens === undefined) return undefined;
  const usage: TokenUsage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
  };
  if (u.cached_input_tokens !== undefined) usage.cacheReadTokens = u.cached_input_tokens;
  return usage;
}

/**
 * Classify a codex error message string into an AdapterError subclass so
 * consumers can `instanceof`-branch. Covers the real shapes captured from
 * codex v0.133.0 (e.g. "402 Payment Required ... deactivated_workspace").
 */
export function classifyCodexError(message: string): AdapterError {
  const lower = message.toLowerCase();
  if (
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('not logged in') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication')
  ) {
    return new AuthError(`codex-cli: ${message}`);
  }
  if (
    lower.includes('402') ||
    lower.includes('payment required') ||
    lower.includes('deactivated_workspace') ||
    lower.includes('quota') ||
    lower.includes('credit') ||
    lower.includes('billing') ||
    lower.includes('insufficient')
  ) {
    return new BillingError(`codex-cli: ${message}`);
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('rate_limit')) {
    return new RateLimitError(`codex-cli: ${message}`);
  }
  return new ProviderError(`codex-cli: ${message}`);
}
