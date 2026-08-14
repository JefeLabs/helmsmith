/**
 * @helmsmith/agent-adapter-langchain — LangChain/LangGraph companion to
 * @helmsmith/agent-adapter.
 *
 * Carries the @langchain/* dependency so it stays out of the platform adapter
 * library. Exposes:
 *   - HarnessChatModel / createHarnessChatModel — wrap a platform AgentAdapter
 *     as a LangChain BaseChatModel.
 *   - LangGraphAdapter — drive a compiled LangGraph through the platform's
 *     AgentInput → AgentInvocationResult I/O shape.
 *
 * REGISTERS NOTHING. This is a library, not a composition root: the AgentSpec
 * comes from the caller, so the caller decides which adapters exist. Register
 * them at your app's entry point before calling createAgent():
 *
 *   import { registerClaudeSdk } from '@helmsmith/agent-adapter/adapters/claude-sdk';
 *   registerClaudeSdk();
 *
 * Registering here would force every consumer of this package to carry those
 * providers' SDKs, which is exactly what the adapter externalization removed.
 */

export {
  type CreateHarnessChatModelOptions,
  createHarnessChatModel,
  HarnessChatModel,
  type HarnessChatModelOptions,
} from './harness-chat-model.ts';
export {
  type CompiledGraph,
  LangGraphAdapter,
  type LangGraphAdapterOptions,
} from './langgraph-adapter.ts';
