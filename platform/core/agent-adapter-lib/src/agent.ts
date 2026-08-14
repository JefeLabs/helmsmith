/**
 * Core agent types for the new agent-adapter surface (Phase A).
 *
 * Lives in src/agent.ts (NOT types.ts, which belongs to the old surface).
 * Not exported from index.ts until Phase F — coexistence rule applies.
 *
 * Types are verbatim from PRD §7 with AgentChunk delegated to stream.ts
 * (referenced via import type to avoid circular runtime dependency).
 */

import type { CredentialBroker } from './credentials/broker.ts';
// Forward-ref to avoid circular runtime dep: agent.ts ↔ stream.ts
import type { AgentChunk } from './stream.ts';

// ---------------------------------------------------------------------------
// AgentSpecType — discriminator for AgentSpec
// ---------------------------------------------------------------------------

/**
 * Open adapter-type registry.
 *
 * Each adapter module augments this interface via `declare module`, so importing
 * an adapter contributes its type. External packages augment it the same way —
 * that is what lets an out-of-tree adapter register without casts.
 *
 * SCOPE: TypeScript applies module augmentations per PROGRAM, not per import.
 * Within one tsconfig, every adapter file in the program contributes regardless
 * of who imports it. The narrowing is therefore real across program boundaries
 * (a consuming package that never pulls in an adapter file) but NOT within this
 * library's own typecheck.
 *
 * FALLBACK: with nothing augmented, `keyof` yields `never`, which would make
 * AgentAdapter unimplementable for type-only consumers — they could not even
 * write `type: never`. harness-server's `class TestAdapter implements
 * AgentAdapter` is exactly that case. Falling back to `string` keeps those
 * packages working without forcing them to import adapters they never call.
 */
// MUST stay an `interface`: adapter modules extend it via `declare module`
// declaration merging, which works on interfaces only. As a `type` alias every
// augmentation becomes a duplicate identifier and the open registry breaks.
// MUST stay an empty `interface`: adapter modules extend it via `declare module`
// declaration merging, which works on interfaces only. As a `type` alias every
// augmentation becomes a duplicate identifier and the open registry breaks.
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging target; adapters augment it
export interface AgentSpecRegistry {}

type RegisteredSpecTypes = keyof AgentSpecRegistry & string;

/** Adapter type identifiers contributed to this program. */
export type AgentSpecType = [RegisteredSpecTypes] extends [never] ? string : RegisteredSpecTypes;

// ---------------------------------------------------------------------------
// AgentSpec — discriminated union (each variant carries its own fields)
// ---------------------------------------------------------------------------

export interface BaseSpec {
  /** Target model identifier (passed verbatim to the backend). */
  model: string;
  /** Optional system prompt override at the spec level. */
  systemPrompt?: string;
}

/** Discriminated union of all supported adapter specs. */
export type AgentSpec = [RegisteredSpecTypes] extends [never]
  ? BaseSpec & { type: string }
  : AgentSpecRegistry[RegisteredSpecTypes];

// ---------------------------------------------------------------------------
// I/O types (PRD §7)
// ---------------------------------------------------------------------------

/**
 * Structured content block — text, tool-use invocation, thinking, or a
 * tool-result fed back to the model.
 *
 * `tool-result` lets a host feed a tool's OUTPUT back through AgentInput so the
 * host-loop SDK adapters (claude-sdk, openai-sdk, gemini-sdk, copilot-sdk,
 * bedrock-sdk) can continue an in-progress tool-use turn. `toolCallId` matches
 * the `id` of the originating `tool-use` block; `output` is the (string)
 * result the tool produced. `toolName` is optional — a host that knows the
 * invoked tool's name may set it so adapters that correlate a result by NAME
 * (Gemini matches FunctionResponse.name to FunctionCall.name, not just an id)
 * can populate it without re-deriving it from the originating tool-use block.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool-use'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName?: string; output: string }
  | { type: 'thinking'; thinking: string };

/**
 * A single message in a conversation turn.
 *
 * The `tool` role carries tool-result content blocks back to the model (the
 * counterpart to an assistant `tool-use` block). A tool-result block may also
 * appear inside a `user` turn — both forms are accepted and serialized to each
 * provider's tool-result shape by the host-loop adapters.
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

/** JSON-Schema-described tool that the adapter may call. */
export interface ToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema object describing the tool's input. */
  inputSchema?: Record<string, unknown>;
}

/** Normalized invocation input — messages, optional overrides, optional tools. */
export interface AgentInput {
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { name: string };
}

/** Per-call invocation options. */
export interface InvokeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** When true, the result includes request + raw response in `capture`. */
  capture?: boolean;
}

/** Token-consumption breakdown. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Full request+response capture, attached to the result when opts.capture === true. */
export interface AgentCapture {
  request: AgentInput;
  response: AgentInvocationResult;
  raw?: unknown;
}

/** Normalized invocation result returned by `AgentAdapter.invoke()`. */
export interface AgentInvocationResult {
  /** Primary assistant text (concatenated text-deltas). */
  content: string;
  /** Structured blocks (text, tool-use, thinking). */
  contentBlocks?: ContentBlock[];
  usage?: TokenUsage;
  finishReason?: 'stop' | 'length' | 'tool_use' | 'content_filter' | 'aborted' | 'error';
  /** Present only when InvokeOptions.capture === true. */
  capture?: AgentCapture;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// AdapterCapabilities (defined here; re-exported from capabilities.ts)
// ---------------------------------------------------------------------------

/** Boolean capability flags reported by every adapter. */
export interface AdapterCapabilities {
  reportsUsage: boolean;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
  /**
   * How the adapter executes tool calls:
   *   - 'autonomous' — the backend runs tools itself (agentic CLIs, claude-agent-sdk);
   *   - 'host-loop'  — the adapter surfaces tool-use events and the host re-invokes
   *     with the tool result (the chat-mode SDK adapters);
   *   - 'none'       — no tool use at all.
   * `supportsToolUse` is the derived convenience flag (`toolUseMode !== 'none'`).
   */
  toolUseMode: 'autonomous' | 'host-loop' | 'none';
  supportsExtendedThinking: boolean;
  supportsCancellation: boolean;
  supportsCapture: boolean;
  /**
   * Whether the adapter accepts a JSON-mode / structured-output request flag
   * (e.g. OpenAI `response_format`). Anthropic-backed adapters report false —
   * use tool-use with a JSON schema for structured output instead.
   * For multi-backend transports (Copilot), this is resolved at construction
   * by inspecting spec.model against a known-models allowlist.
   */
  supportsJsonMode: boolean;
  supportsSessionResume: boolean;
}

// ---------------------------------------------------------------------------
// Logger (minimal, optional)
// ---------------------------------------------------------------------------

export interface Logger {
  debug?: (message: string, ...args: unknown[]) => void;
  info?: (message: string, ...args: unknown[]) => void;
  warn?: (message: string, ...args: unknown[]) => void;
  error?: (message: string, ...args: unknown[]) => void;
}

// ---------------------------------------------------------------------------
// AgentAdapter — public interface (PRD §7)
// ---------------------------------------------------------------------------

/** The uniform adapter interface all backends implement. */
export interface AgentAdapter {
  readonly type: AgentSpecType;
  readonly capabilities: AdapterCapabilities;
  /** Resolved absolute working-tree path; immutable per adapter instance. */
  readonly workdir: string;

  invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult>;
  stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk>;
}

// ---------------------------------------------------------------------------
// CreateAgentArgs — factory input (PRD §7)
// ---------------------------------------------------------------------------

export interface CreateAgentArgs {
  /** Describes the target backend (model, type, optional keys). */
  spec: AgentSpec;
  /**
   * REQUIRED — must be a git working tree. Validated at createAgent time via
   * `git rev-parse --is-inside-work-tree`. Throws WorkdirNotARepoError on
   * failure. Immutable per adapter instance.
   */
  workdir: string;
  /** Supplies provider credentials. Optional — adapters fall back to env vars. */
  credentialBroker?: CredentialBroker;
  logger?: Logger;
  /** Aborts the construction (e.g. binary-version check). */
  signal?: AbortSignal;
}
