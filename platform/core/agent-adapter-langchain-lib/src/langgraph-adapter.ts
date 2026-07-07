/**
 * LangGraphAdapter — wraps a compiled LangGraph as a callable agent.
 *
 * Lives in @helmsmith/agent-adapter-langchain (the LangChain companion to
 * @helmsmith/agent-adapter) so the @langchain/* dependency stays OUT of the
 * platform adapter library.
 *
 * NOTE: this is NOT a platform `AgentAdapter` — it has no AgentSpecType, no
 * workdir, and is not registry-constructed via createAgent(). It is a
 * standalone wrapper that speaks the platform's NEW I/O types
 * (`invoke(AgentInput) → AgentInvocationResult`) so a host can drive a compiled
 * LangGraph through the same input/output shape as a real adapter. One
 * `invoke()` runs the graph start-to-finish and returns the final state's
 * response field as `content`.
 *
 * Changes from the pre-cut (old-surface) version:
 *   - `invoke()` now takes an `AgentInput` and returns an `AgentInvocationResult`
 *     (was `invoke(InvocationSpec): Promise<string>`).
 *   - The `events`/`AdapterEventBus` surface is dropped — the v1 cut never
 *     bridged per-node LangGraph events and no consumer subscribed to them.
 *
 * What this v1 still does NOT do (deferred): streaming responses, state
 * persistence / checkpointing (the caller passes a fresh or pre-checkpointed
 * compiled graph).
 */

import type { AgentInput, AgentInvocationResult, ContentBlock } from '@helmsmith/agent-adapter';

/**
 * Generic input/output accepted by LangGraph's compiled graph. We don't narrow
 * further — LangGraph state shapes are user-defined.
 */
type GraphInput = Record<string, unknown>;
type GraphOutput = Record<string, unknown>;

/**
 * Compiled LangGraph contract — minimal structural type exposing
 * `invoke(input) → Promise<output>`. Structural typing (rather than
 * `Runnable<I, O>` from @langchain/core) keeps this wrapper compatible with
 * whatever specific compiled-graph shape `StateGraph.compile()` returns.
 */
export interface CompiledGraph {
  invoke(input: GraphInput, options?: unknown): Promise<GraphOutput>;
}

export interface LangGraphAdapterOptions {
  /** The compiled LangGraph this adapter runs. */
  graph: CompiledGraph;
  /**
   * Field name on the graph's final state that holds the response text. The
   * adapter returns `result[responseKey]` as `content`. Default: `'output'`.
   */
  responseKey?: string;
  /**
   * How to construct the initial graph state from the AgentInput. Default:
   * `{ input: <last user message text>, system: <systemPrompt> }`. Override to
   * map the input into your graph's specific channel structure.
   */
  buildInitialState?: (input: AgentInput) => GraphInput;
}

export class LangGraphAdapter {
  constructor(private readonly opts: LangGraphAdapterOptions) {}

  async invoke(input: AgentInput): Promise<AgentInvocationResult> {
    const start = Date.now();
    const buildInitial = this.opts.buildInitialState ?? defaultBuildInitialState;
    const responseKey = this.opts.responseKey ?? 'output';

    const result = await this.opts.graph.invoke(buildInitial(input));

    const raw = result[responseKey];
    const content = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw);
    return { content, durationMs: Date.now() - start };
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

function defaultBuildInitialState(input: AgentInput): GraphInput {
  const userText = lastUserText(input);
  return input.systemPrompt !== undefined
    ? { input: userText, system: input.systemPrompt }
    : { input: userText };
}

/** Text of the last user-role message (falls back to the final message). */
function lastUserText(input: AgentInput): string {
  for (let i = input.messages.length - 1; i >= 0; i--) {
    const msg = input.messages[i]!;
    if (msg.role === 'user') return stringifyContent(msg.content);
  }
  const last = input.messages[input.messages.length - 1];
  return last ? stringifyContent(last.content) : '';
}

/** Flatten a ChatMessage's content (string or content blocks) to a string. */
function stringifyContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : JSON.stringify(block)))
    .join('\n');
}
