/**
 * @helmsmith/agent-adapter — public surface (PRD §6/§7).
 *
 * The `createAgent()`-based surface. Importing this module registers NOTHING
 * and loads no provider SDK — that is what lets a host carry only the providers
 * it actually uses.
 *
 * To make an adapter available, import its entry and call its registrar at your
 * composition root:
 *
 *   import { registerCodexCli } from '@helmsmith/agent-adapter/adapters/codex-cli';
 *   registerCodexCli();
 *
 * To browse what exists before choosing, read ADAPTER_CATALOG — static data that
 * needs no adapter module loaded.
 *
 * The conformance suite is a separate entry point:
 * `@helmsmith/agent-adapter/conformance`.
 */

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
export { getCapabilities, intersectCapabilities, listAdapterTypes } from './capabilities.ts';
// --- Catalog (catalog.ts) ----------------------------------------------------
// The "what exists" plane: static, readable with nothing registered.
export { ADAPTER_CATALOG, type AdapterCatalogEntry } from './catalog.ts';
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
// DEPRECATED here: import from '@helmsmith/agent-adapter/adapters/opencode-cli'.
// Retained only until harness-pipeline-cli migrates, then removed. A helper for
// one provider does not belong on the provider-neutral root.
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
