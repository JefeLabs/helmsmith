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
  | 'gemini-cli'
  | 'gemini-sdk'
  | 'openai-sdk'
  | 'codex-cli'
  | 'bedrock-sdk';

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

/**
 * Google Gemini SDK — in-process `@google/genai`, chat-mode host-loop tool use
 * (provider: google). Mirrors claude-sdk: stream()/invoke()=reduceStream,
 * broker auth, API-level tool-use surfaced as tool-call-* chunks.
 */
export interface GeminiSdkSpec extends BaseSpec {
  type: 'gemini-sdk';
  /**
   * Pre-resolved Google/Gemini API key (skips CredentialBroker when set). When
   * unset, resolved via broker.getCredential('google'); falls back to the
   * GEMINI_API_KEY / GOOGLE_API_KEY environment variables.
   */
  apiKey?: string;
}

/**
 * OpenAI SDK — in-process `openai` Chat Completions, chat-mode host-loop tool
 * use (provider: openai). Mirrors claude-sdk: stream()/invoke()=reduceStream,
 * broker auth, API-level tool-use surfaced as tool-call-* chunks.
 */
export interface OpenAiSdkSpec extends BaseSpec {
  type: 'openai-sdk';
  /**
   * Pre-resolved OpenAI API key (skips CredentialBroker when set). When unset,
   * resolved via broker.getCredential('openai'); falls back to the
   * OPENAI_API_KEY environment variable.
   */
  apiKey?: string;
}

/**
 * Standalone GitHub Copilot CLI (`copilot`) — autonomous built-in tools,
 * headless via `copilot -p <prompt> --allow-all-tools --add-dir <workdir>`.
 *
 * Auth (PRD §8.5 / §12): the standalone `copilot` reads its token from the env
 * vars COPILOT_GITHUB_TOKEN → GH_TOKEN → GITHUB_TOKEN (in that precedence). The
 * adapter sandboxes $HOME to the workdir, hiding `copilot login`'s stored
 * credential store, so an env token is required for headless use.
 */
export interface CopilotCliSpec extends BaseSpec {
  type: 'copilot-cli';
  binaryPath?: string;
  env?: Record<string, string>;
}

/**
 * Gemini CLI subprocess (`gemini`, provider: google). Autonomous built-in
 * tools, headless via `-p <prompt> -o stream-json --approval-mode yolo`.
 */
export interface GeminiCliSpec extends BaseSpec {
  type: 'gemini-cli';
  binaryPath?: string;
  env?: Record<string, string>;
  /**
   * Pre-resolved Google/Gemini API key. When unset, resolved via
   * broker.getCredential('google') → injected as GEMINI_API_KEY (the var the
   * gemini CLI reads for USE_GEMINI API-key auth; the $HOME sandbox hides its
   * own OAuth state). Falls back to the GEMINI_API_KEY env var.
   */
  apiKey?: string;
  /**
   * Tool-approval mode passed to `--approval-mode`. Defaults to 'yolo'
   * (auto-approve all tools) so the agent runs non-interactively.
   */
  approvalMode?: 'default' | 'auto_edit' | 'yolo' | 'plan';
}

/**
 * Codex CLI subprocess (`codex`, provider: openai). Autonomous built-in tools,
 * headless via the `codex exec <prompt> --json` non-interactive subcommand.
 */
export interface CodexCliSpec extends BaseSpec {
  type: 'codex-cli';
  binaryPath?: string;
  env?: Record<string, string>;
  /**
   * Pre-resolved OpenAI API key. When unset, resolved via
   * broker.getCredential('openai') → injected as OPENAI_API_KEY (the $HOME
   * sandbox hides codex's own ~/.codex/auth.json ChatGPT OAuth). Falls back to
   * the OPENAI_API_KEY env var.
   */
  apiKey?: string;
  /**
   * Sandbox policy for `codex exec --sandbox`. Defaults to 'workspace-write'
   * (writes confined to the workspace + temp; network off) — the safe
   * non-interactive choice. The adapter additionally sandboxes $HOME/$TMPDIR
   * to the workdir.
   */
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

/**
 * AWS Bedrock SDK — in-process `@aws-sdk/client-bedrock-runtime` Converse /
 * ConverseStream, chat-mode host-loop tool use (provider: bedrock). Mirrors
 * claude-sdk: stream()/invoke()=reduceStream, API-level tool-use surfaced as
 * tool-call-* chunks.
 *
 * AUTH WRINKLE: unlike the other SDK adapters, Bedrock does NOT take an
 * `apiKey`. It authenticates via the AWS credential chain (env vars, shared
 * `~/.aws` config, SSO, IAM role). The `CredentialBroker` is therefore bypassed
 * for this type — the AWS SDK resolves credentials itself. See the adapter
 * docstring for the full rationale.
 */
export interface BedrockSdkSpec extends BaseSpec {
  type: 'bedrock-sdk';
  /**
   * AWS region the Bedrock runtime client targets (e.g. 'us-east-1'). REQUIRED:
   * resolved from this field or the AWS_REGION / AWS_DEFAULT_REGION env var. The
   * adapter throws ConfigError at construction when neither is present.
   */
  region?: string;
  /**
   * Optional AWS named profile (from `~/.aws/credentials` / `~/.aws/config`).
   * When set, the adapter surfaces it to the AWS default credential chain via
   * the standard AWS_PROFILE env convention (it does not clobber an AWS_PROFILE
   * already set in the environment).
   */
  profile?: string;
}

/** Discriminated union of all supported adapter specs. */
export type AgentSpec =
  | ClaudeSdkSpec
  | ClaudeAgentSdkSpec
  | ClaudeCodeCliSpec
  | OpenCodeCliSpec
  | CopilotSdkSpec
  | CopilotCliSpec
  | GeminiCliSpec
  | GeminiSdkSpec
  | OpenAiSdkSpec
  | CodexCliSpec
  | BedrockSdkSpec;

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
 * result the tool produced.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool-use'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; output: string }
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
