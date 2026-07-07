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
