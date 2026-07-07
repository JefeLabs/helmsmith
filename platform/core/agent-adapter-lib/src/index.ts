/**
 * @helmsmith/agent-adapter — public surface (PRD §6/§7).
 *
 * The `createAgent()`-based surface. Importing this module registers all 11
 * built-in adapters as a side-effect (via ./adapters/index.ts) so
 * `createAgent()` resolves any `spec.type` out of the box.
 *
 * The conformance suite is a separate entry point:
 * `@helmsmith/agent-adapter/conformance`.
 */

// Side-effect: register all 11 built-in adapter factories.
import './adapters/index.ts';

// --- Core types (agent.ts) ---------------------------------------------------
export type {
  AdapterCapabilities,
  AgentAdapter,
  AgentCapture,
  AgentInput,
  AgentInvocationResult,
  AgentSpec,
  AgentSpecType,
  BedrockSdkSpec,
  ChatMessage,
  ClaudeAgentSdkSpec,
  ClaudeCodeCliSpec,
  ClaudeSdkSpec,
  CodexCliSpec,
  ContentBlock,
  CopilotCliSpec,
  CopilotSdkSpec,
  CreateAgentArgs,
  GeminiCliSpec,
  GeminiSdkSpec,
  InvokeOptions,
  Logger,
  OpenAiSdkSpec,
  OpenCodeCliSpec,
  TokenUsage,
  ToolDefinition,
} from './agent.ts';
// --- Capabilities (capabilities.ts) ------------------------------------------
export { CAPABILITY_MATRIX, intersectCapabilities, listAdapterTypes } from './capabilities.ts';
// --- Factory -----------------------------------------------------------------
export { createAgent } from './create-agent.ts';
// --- Credentials (credentials/broker.ts) -------------------------------------
export type { CredentialBroker } from './credentials/broker.ts';
// --- Error taxonomy (errors.ts) ----------------------------------------------
export {
  AdapterError,
  AuthError,
  BillingError,
  BinaryNotFoundError,
  CapabilityMismatchError,
  ConfigError,
  classifyHttpError,
  classifyNetworkError,
  MissingCredentialError,
  NetworkError,
  ProviderError,
  RateLimitError,
  WorkdirNotARepoError,
} from './errors.ts';
// --- OpenCode server helper --------------------------------------------------
// Interface-agnostic utility (node builtins only) for spawning / attaching to a
// long-running `opencode serve`. Kept on the barrel because a consumer
// (harness-pipeline-cli) imports it directly and it carries no old-surface
// coupling.
export {
  OpenCodeServer,
  OpenCodeServerError,
  type OpenCodeServerHandle,
  type OpenCodeServerOptions,
  type OpencodeProviderEntry,
} from './opencode-server.ts';
// --- Registry (registry.ts) --------------------------------------------------
export type { AdapterDeps, AdapterFactory } from './registry.ts';
export {
  getAdapterFactory,
  registerAdapter,
  registeredAdapterTypes,
} from './registry.ts';
// --- Stream (stream.ts) ------------------------------------------------------
export type { AgentChunk, PushQueueHandle } from './stream.ts';
export { createPushQueue, reduceStream } from './stream.ts';
