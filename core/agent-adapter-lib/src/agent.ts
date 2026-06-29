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

/** All supported adapter type identifiers. */
export type AgentSpecType =
  | 'claude-sdk'
  | 'claude-agent-sdk'
  | 'claude-code-cli'
  | 'opencode-cli'
  | 'copilot-sdk'
  | 'copilot-cli'
  | 'copilot-agent-cli';

// ---------------------------------------------------------------------------
// AgentSpec — discriminated union (each variant carries its own fields)
// ---------------------------------------------------------------------------

interface BaseSpec {
  /** Target model identifier (passed verbatim to the backend). */
  model: string;
  /** Optional system prompt override at the spec level. */
  systemPrompt?: string;
}

/** Anthropic SDK — in-process, single-turn host-loop tool use. */
export interface ClaudeSdkSpec extends BaseSpec {
  type: 'claude-sdk';
  /** Pre-resolved API key (skips CredentialBroker when set). */
  apiKey?: string;
}

/** Anthropic agent SDK — autonomous tool use, extended thinking, streaming. */
export interface ClaudeAgentSdkSpec extends BaseSpec {
  type: 'claude-agent-sdk';
  apiKey?: string;
}

/** Claude Code CLI subprocess. */
export interface ClaudeCodeCliSpec extends BaseSpec {
  type: 'claude-code-cli';
  binaryPath?: string;
  env?: Record<string, string>;
  apiKey?: string;
}

/** OpenCode CLI subprocess. */
export interface OpenCodeCliSpec extends BaseSpec {
  type: 'opencode-cli';
  binaryPath?: string;
  env?: Record<string, string>;
  apiKey?: string;
  /**
   * Provider whose credential is injected as an env var (anthropic →
   * ANTHROPIC_API_KEY, openai → OPENAI_API_KEY, google → GOOGLE_API_KEY).
   * Defaults to the `<provider>/` prefix of `model`. Ignored in local-endpoint
   * mode (`endpoint` set).
   */
  provider?: string;
  /**
   * HTTP endpoint of an OpenAI-compatible inference server. When set, the
   * adapter SKIPS broker credential lookup and writes a custom provider into a
   * temp opencode.json pointing at this baseURL (self-hosted models). Ported
   * from the old flat adapter's local-endpoint mode.
   */
  endpoint?: string;
  /** Logical provider id for the local `endpoint`. Defaults to `'local'`. */
  endpointProviderId?: string;
  /** Static API key for the local `endpoint` (servers usually ignore it). */
  staticApiKey?: string;
  /**
   * URL of a long-running `opencode serve` instance. When set, the adapter
   * runs `opencode run --attach <serverUrl> ...` so a warm server is shared
   * across invocations. Ported from the old flat adapter's serverUrl mode.
   */
  serverUrl?: string;
  /**
   * Auto-approve built-in tool permissions (`--dangerously-skip-permissions`)
   * so the agent runs tools autonomously in headless mode. Off by default; the
   * adapter sandboxes $HOME/$TMPDIR + cwd to the workdir, bounding blast radius.
   */
  dangerouslySkipPermissions?: boolean;
}

/** GitHub Copilot Chat HTTP API (OpenAI-compatible). */
export interface CopilotSdkSpec extends BaseSpec {
  type: 'copilot-sdk';
  apiKey?: string;
}

/** `gh copilot suggest` CLI — single-turn shell-suggestion, limited capability. */
export interface CopilotCliSpec extends BaseSpec {
  type: 'copilot-cli';
  binaryPath?: string;
  env?: Record<string, string>;
  /** Suggest target. Defaults to 'shell'. */
  subcommand?: 'shell' | 'git' | 'gh';
}

/** Agentic Copilot CLI — autonomous tool use via gh extension. */
export interface CopilotAgentCliSpec extends BaseSpec {
  type: 'copilot-agent-cli';
  binaryPath?: string;
  env?: Record<string, string>;
  apiKey?: string;
}

/** Discriminated union of all supported adapter specs. */
export type AgentSpec =
  | ClaudeSdkSpec
  | ClaudeAgentSdkSpec
  | ClaudeCodeCliSpec
  | OpenCodeCliSpec
  | CopilotSdkSpec
  | CopilotCliSpec
  | CopilotAgentCliSpec;

// ---------------------------------------------------------------------------
// I/O types (PRD §7)
// ---------------------------------------------------------------------------

/** Structured content block — text, tool-use invocation, or thinking. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool-use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string };

/** A single message in a conversation turn. */
export interface ChatMessage {
  role: 'user' | 'assistant';
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
