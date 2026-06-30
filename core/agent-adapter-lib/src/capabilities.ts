/**
 * Adapter capability descriptors + listAdapterTypes() (PRD §8.7).
 *
 * CAPABILITY_MATRIX is the single source of truth for what each adapter
 * type can do. The registry references this matrix (adapters self-register
 * in Phase B–D′ but the static caps come from here).
 *
 * AdapterCapabilities is defined in agent.ts (shared core type); re-exported
 * from here for callers that only import from this module.
 */

import type { AdapterCapabilities, AgentSpecType } from './agent.ts';

export type { AdapterCapabilities } from './agent.ts';

// ---------------------------------------------------------------------------
// CAPABILITY_MATRIX (PRD §8.7 + chat/agent split for new types)
// ---------------------------------------------------------------------------

/**
 * Static capability matrix for all built-in adapter types.
 *
 * TBD cells (opencode-cli reportsUsage, supportsExtendedThinking) are set
 * conservatively (false) until verified against the live tool in Phase D.
 *
 * copilot-sdk supportsJsonMode: false in the static matrix — at construction
 * the adapter resolves this from spec.model against a known-models allowlist
 * and may override (Phase D′).
 */
export const CAPABILITY_MATRIX: Record<AgentSpecType, AdapterCapabilities> = {
  'claude-sdk': {
    reportsUsage: true,
    supportsStreaming: true,
    supportsToolUse: true, // host-loop: adapter surfaces tool-use events; host re-invokes
    supportsExtendedThinking: true,
    supportsCancellation: true,
    supportsCapture: true,
    supportsJsonMode: false, // Anthropic uses tool-use for structured output
    supportsSessionResume: false,
  },

  'claude-agent-sdk': {
    reportsUsage: true,
    supportsStreaming: true,
    supportsToolUse: true, // autonomous tool execution via the Agent SDK
    supportsExtendedThinking: true,
    supportsCancellation: true,
    supportsCapture: true,
    supportsJsonMode: false,
    supportsSessionResume: false,
  },

  'claude-code-cli': {
    reportsUsage: true,
    supportsStreaming: true,
    supportsToolUse: true, // built-in tools (Read, Edit, Bash…); host cannot inject
    supportsExtendedThinking: true,
    supportsCancellation: true, // SIGTERM
    supportsCapture: true, // transcript file
    supportsJsonMode: false, // wraps Anthropic — no response_format surface
    supportsSessionResume: false, // v1.1
  },

  'opencode-cli': {
    reportsUsage: false, // TBD — verify opencode emits usage in JSON output (Phase D)
    supportsStreaming: true,
    supportsToolUse: true, // built-in tools; host cannot inject
    supportsExtendedThinking: false, // TBD — verify against upstream
    supportsCancellation: true, // SIGTERM
    supportsCapture: true, // transcript file
    supportsJsonMode: false,
    supportsSessionResume: false,
  },

  'copilot-sdk': {
    reportsUsage: true, // OpenAI-style usage block
    supportsStreaming: true, // SSE
    supportsToolUse: true, // OpenAI-style function calling; host can inject custom tools
    supportsExtendedThinking: false,
    supportsCancellation: true, // AbortSignal aborts the fetch
    supportsCapture: true,
    supportsJsonMode: false, // model-dependent; resolved at construction in Phase D′
    supportsSessionResume: false, // server-side invocation-scoped
  },

  'copilot-cli': {
    reportsUsage: false, // gh copilot does not report tokens
    supportsStreaming: false, // single-block output
    supportsToolUse: false, // gh copilot is shell-suggestion only
    supportsExtendedThinking: false,
    supportsCancellation: true, // SIGTERM
    supportsCapture: true, // full stdout transcript
    supportsJsonMode: false,
    supportsSessionResume: false,
  },

  'copilot-agent-cli': {
    reportsUsage: false,
    supportsStreaming: true,
    supportsToolUse: true,
    supportsExtendedThinking: false,
    supportsCancellation: true, // SIGTERM
    supportsCapture: true,
    supportsJsonMode: false,
    supportsSessionResume: false,
  },

  // Verified against the REAL `gemini` CLI v0.43.0 stream-json output
  // (@google/gemini-cli-core JsonStreamEventType: init/message/tool_use/
  // tool_result/error/result).
  'gemini-cli': {
    reportsUsage: true, // result event carries stats { input_tokens, output_tokens }
    supportsStreaming: true, // -o stream-json (newline-delimited JSON events)
    supportsToolUse: true, // autonomous built-in tools; --approval-mode yolo
    supportsExtendedThinking: false, // stream-json has no thinking/reasoning event type
    supportsCancellation: true, // SIGTERM
    supportsCapture: true, // full stream-json transcript
    supportsJsonMode: false, // -o json is an OUTPUT format, not a model response_format
    supportsSessionResume: false, // --resume exists but not wired (v1.1)
  },

  // Verified against the REAL `codex` CLI v0.133.0 `codex exec --json` events
  // (thread.started/turn.started/turn.completed/turn.failed/item.completed/error;
  // ThreadItem variants agent_message/reasoning/command_execution/file_change/
  // mcp_tool_call/web_search).
  'codex-cli': {
    reportsUsage: true, // turn.completed.usage { input_tokens, output_tokens, cached_input_tokens }
    supportsStreaming: true, // --json (JSONL thread events)
    supportsToolUse: true, // autonomous built-in tools (exec/patch/mcp/web_search)
    supportsExtendedThinking: true, // emits reasoning ThreadItems → thinking-delta
    supportsCancellation: true, // SIGTERM
    supportsCapture: true, // full JSONL transcript
    supportsJsonMode: false, // codex exec has --output-schema, but the adapter doesn't wire it
    supportsSessionResume: false, // codex exec resume exists but not wired (v1.1)
  },
};

// ---------------------------------------------------------------------------
// listAdapterTypes
// ---------------------------------------------------------------------------

/**
 * Return all AgentSpecTypes whose capability descriptor matches every key
 * in the filter. An empty (or absent) filter returns all types.
 *
 * Example:
 *   listAdapterTypes({ supportsToolUse: true })   // excludes copilot-cli
 *   listAdapterTypes({ supportsStreaming: true })  // excludes copilot-cli
 *   listAdapterTypes()                             // all 7 types
 */
export function listAdapterTypes(filter?: Partial<AdapterCapabilities>): AgentSpecType[] {
  const entries = Object.entries(CAPABILITY_MATRIX) as [AgentSpecType, AdapterCapabilities][];
  if (!filter || Object.keys(filter).length === 0) {
    return entries.map(([type]) => type);
  }
  return entries
    .filter(([, caps]) =>
      (Object.keys(filter) as (keyof AdapterCapabilities)[]).every(
        (key) => caps[key] === filter[key],
      ),
    )
    .map(([type]) => type);
}

// ---------------------------------------------------------------------------
// intersectCapabilities
// ---------------------------------------------------------------------------

/**
 * Compute the intersection of two capability sets: for each boolean flag,
 * the result is true only if BOTH inputs are true. Useful for determining
 * the effective capabilities when composing adapters.
 */
export function intersectCapabilities(
  a: AdapterCapabilities,
  b: AdapterCapabilities,
): AdapterCapabilities {
  return {
    reportsUsage: a.reportsUsage && b.reportsUsage,
    supportsStreaming: a.supportsStreaming && b.supportsStreaming,
    supportsToolUse: a.supportsToolUse && b.supportsToolUse,
    supportsExtendedThinking: a.supportsExtendedThinking && b.supportsExtendedThinking,
    supportsCancellation: a.supportsCancellation && b.supportsCancellation,
    supportsCapture: a.supportsCapture && b.supportsCapture,
    supportsJsonMode: a.supportsJsonMode && b.supportsJsonMode,
    supportsSessionResume: a.supportsSessionResume && b.supportsSessionResume,
  };
}
