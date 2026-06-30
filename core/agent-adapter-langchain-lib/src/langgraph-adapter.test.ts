/**
 * LangGraphAdapter tests (companion package).
 *
 * Uses real `@langchain/langgraph` graphs (not mocks) — the surface is thin
 * enough that the unit-test boundary IS the graph's invoke() behavior. Graphs
 * are no-LLM so tests run offline. Each graph is a pure data transformation:
 * input goes in, deterministic output comes out.
 *
 * Coverage (post-cut, NEW I/O shape — AgentInput → AgentInvocationResult):
 *   - invoke() returns the responseKey field as result.content
 *   - multi-node graphs thread to a final response
 *   - custom responseKey + custom buildInitialState
 *   - systemPrompt flows into the default initial state
 *   - non-string responses coerce to JSON; missing field → empty content
 */

import { type AgentInput } from '@helmsmith/agent-adapter';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { type CompiledGraph, LangGraphAdapter } from './langgraph-adapter.ts';

/** Build an AgentInput from a bare user string (+ optional system prompt). */
function userInput(user: string, system?: string): AgentInput {
  const input: AgentInput = { messages: [{ role: 'user', content: user }] };
  if (system !== undefined) input.systemPrompt = system;
  return input;
}

/** Echo graph: { input: string } → { output: 'echo: <input>' }. */
function echoGraph(): CompiledGraph {
  const State = Annotation.Root({
    input: Annotation<string>,
    output: Annotation<string>,
  });
  const builder = new StateGraph(State)
    .addNode('echo', (state) => ({ output: `echo: ${state.input}` }))
    .addEdge(START, 'echo')
    .addEdge('echo', END);
  return builder.compile() as unknown as CompiledGraph;
}

/** Two-step: capitalize then prefix. Multi-node flow visible to the adapter
 *  only as final state. */
function twoStepGraph(): CompiledGraph {
  const State = Annotation.Root({
    input: Annotation<string>,
    capped: Annotation<string>,
    output: Annotation<string>,
  });
  const builder = new StateGraph(State)
    .addNode('cap', (state) => ({ capped: state.input.toUpperCase() }))
    .addNode('prefix', (state) => ({ output: `>> ${state.capped}` }))
    .addEdge(START, 'cap')
    .addEdge('cap', 'prefix')
    .addEdge('prefix', END);
  return builder.compile() as unknown as CompiledGraph;
}

/** Graph that throws — exercises error propagation. */
function throwingGraph(): CompiledGraph {
  const State = Annotation.Root({
    input: Annotation<string>,
    output: Annotation<string>,
  });
  const builder = new StateGraph(State)
    .addNode('fail', () => {
      throw new Error('intentional graph failure');
    })
    .addEdge(START, 'fail')
    .addEdge('fail', END);
  return builder.compile() as unknown as CompiledGraph;
}

describe('LangGraphAdapter', () => {
  it('runs a simple graph end-to-end and returns the output field as content', async () => {
    const adapter = new LangGraphAdapter({ graph: echoGraph() });
    const result = await adapter.invoke(userInput('hello'));
    expect(result.content).toBe('echo: hello');
    expect(typeof result.durationMs).toBe('number');
  });

  it('flows systemPrompt + last user message into the default initial state', async () => {
    const State = Annotation.Root({
      input: Annotation<string>,
      system: Annotation<string>,
      output: Annotation<string>,
    });
    const builder = new StateGraph(State)
      .addNode('combine', (s) => ({ output: `${s.system ?? ''}|${s.input}` }))
      .addEdge(START, 'combine')
      .addEdge('combine', END);
    const adapter = new LangGraphAdapter({
      graph: builder.compile() as unknown as CompiledGraph,
    });
    const result = await adapter.invoke(userInput('hi', 'be brief'));
    expect(result.content).toBe('be brief|hi');
  });

  it('threads multi-node graphs to a final response', async () => {
    const adapter = new LangGraphAdapter({ graph: twoStepGraph() });
    const result = await adapter.invoke(userInput('hello'));
    expect(result.content).toBe('>> HELLO');
  });

  it('honors a custom responseKey when the graph names its output field differently', async () => {
    const State = Annotation.Root({
      input: Annotation<string>,
      final: Annotation<string>,
    });
    const builder = new StateGraph(State)
      .addNode('done', (s) => ({ final: `final-${s.input}` }))
      .addEdge(START, 'done')
      .addEdge('done', END);
    const adapter = new LangGraphAdapter({
      graph: builder.compile() as unknown as CompiledGraph,
      responseKey: 'final',
    });
    const result = await adapter.invoke(userInput('X'));
    expect(result.content).toBe('final-X');
  });

  it('honors a custom buildInitialState that maps input to a different channel structure', async () => {
    const State = Annotation.Root({
      question: Annotation<string>,
      output: Annotation<string>,
    });
    const builder = new StateGraph(State)
      .addNode('answer', (s) => ({ output: `Q: ${s.question}` }))
      .addEdge(START, 'answer')
      .addEdge('answer', END);
    const adapter = new LangGraphAdapter({
      graph: builder.compile() as unknown as CompiledGraph,
      buildInitialState: (input) => ({
        question: typeof input.messages[0]!.content === 'string' ? input.messages[0]!.content : '',
      }),
    });
    const result = await adapter.invoke(userInput('are you ok?'));
    expect(result.content).toBe('Q: are you ok?');
  });

  it('re-throws when the graph fails', async () => {
    const adapter = new LangGraphAdapter({ graph: throwingGraph() });
    await expect(adapter.invoke(userInput('x'))).rejects.toThrow('intentional graph failure');
  });

  it('coerces non-string responses to JSON when responseKey targets an object', async () => {
    const State = Annotation.Root({
      input: Annotation<string>,
      output: Annotation<{ value: number }>,
    });
    const builder = new StateGraph(State)
      .addNode('compute', () => ({ output: { value: 42 } }))
      .addEdge(START, 'compute')
      .addEdge('compute', END);
    const adapter = new LangGraphAdapter({
      graph: builder.compile() as unknown as CompiledGraph,
    });
    const result = await adapter.invoke(userInput('ignored'));
    expect(result.content).toBe('{"value":42}');
  });

  it('returns empty content when the responseKey field is missing', async () => {
    const State = Annotation.Root({
      input: Annotation<string>,
      output: Annotation<string>,
    });
    const builder = new StateGraph(State)
      .addNode('noop', () => ({}))
      .addEdge(START, 'noop')
      .addEdge('noop', END);
    const adapter = new LangGraphAdapter({
      graph: builder.compile() as unknown as CompiledGraph,
    });
    const result = await adapter.invoke(userInput('x'));
    expect(result.content).toBe('');
  });
});
