/**
 * HarnessChatModel tests (companion package).
 *
 * Covers (post-cut, NEW adapter surface):
 *   - basic .invoke([HumanMessage]) returns adapter result.content
 *   - SystemMessage flattens into AgentInput.systemPrompt
 *   - multi-message conversations get role-labeled into a single user message
 *   - single-HumanMessage shortcut returns bare content (no label)
 *   - works inside a real LangGraph node via .invoke()
 *   - createHarnessChatModel builds an adapter via createAgent
 *
 * Uses a stub AgentAdapter (the NEW interface) that captures AgentInputs.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AdapterCapabilities,
  type AgentAdapter,
  type AgentChunk,
  type AgentInput,
  type AgentInvocationResult,
  type AgentSpecType,
  CAPABILITY_MATRIX,
} from '@helmsmith/agent-adapter';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { createHarnessChatModel, HarnessChatModel } from './harness-chat-model.ts';
import type { CompiledGraph } from './langgraph-adapter.ts';

class StubAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'claude-sdk';
  readonly capabilities: AdapterCapabilities = CAPABILITY_MATRIX['claude-sdk'];
  readonly workdir = '/tmp';
  readonly invocations: AgentInput[] = [];

  constructor(private readonly response: string = 'stub-response') {}

  async invoke(input: AgentInput): Promise<AgentInvocationResult> {
    this.invocations.push(input);
    return { content: this.response, durationMs: 0 };
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<AgentChunk> {
    // Stub never streams; HarnessChatModel only calls invoke().
  }
}

/** Content of the (single) user message an AgentInput flattens to. */
function userContent(input: AgentInput): string {
  const msg = input.messages[0]!;
  return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
}

describe('HarnessChatModel', () => {
  it('returns the adapter result.content for a single HumanMessage', async () => {
    const adapter = new StubAdapter('answer-here');
    const model = new HarnessChatModel({ adapter });
    const result = await model.invoke([new HumanMessage('hi')]);
    expect(result.content).toBe('answer-here');
  });

  it('uses single-HumanMessage shortcut: bare content, no systemPrompt, no role label', async () => {
    const adapter = new StubAdapter('ok');
    const model = new HarnessChatModel({ adapter });
    await model.invoke([new HumanMessage('what is 2+2?')]);
    expect(adapter.invocations).toHaveLength(1);
    expect(userContent(adapter.invocations[0]!)).toBe('what is 2+2?');
    expect(adapter.invocations[0]!.systemPrompt).toBeUndefined();
  });

  it('joins SystemMessages into systemPrompt', async () => {
    const adapter = new StubAdapter();
    const model = new HarnessChatModel({ adapter });
    await model.invoke([new SystemMessage('you are concise'), new HumanMessage('hi')]);
    expect(adapter.invocations[0]!.systemPrompt).toBe('you are concise');
    expect(userContent(adapter.invocations[0]!)).toBe('User: hi');
  });

  it('joins multiple SystemMessages with double newlines', async () => {
    const adapter = new StubAdapter();
    const model = new HarnessChatModel({ adapter });
    await model.invoke([
      new SystemMessage('rule 1: be concise'),
      new SystemMessage('rule 2: be friendly'),
      new HumanMessage('hi'),
    ]);
    expect(adapter.invocations[0]!.systemPrompt).toBe('rule 1: be concise\n\nrule 2: be friendly');
  });

  it('role-labels multi-turn conversations into the user message', async () => {
    const adapter = new StubAdapter();
    const model = new HarnessChatModel({ adapter });
    await model.invoke([
      new HumanMessage('what is 2+2?'),
      new AIMessage('4'),
      new HumanMessage('and what is 3+3?'),
    ]);
    expect(userContent(adapter.invocations[0]!)).toBe(
      'User: what is 2+2?\n\nAssistant: 4\n\nUser: and what is 3+3?',
    );
  });

  it('handles ToolMessages with the Tool: label', async () => {
    const adapter = new StubAdapter();
    const model = new HarnessChatModel({ adapter });
    await model.invoke([
      new HumanMessage('check weather'),
      new AIMessage('calling weather tool'),
      new ToolMessage({ content: 'sunny, 72F', tool_call_id: 'wx-1' }),
      new HumanMessage('what should I wear?'),
    ]);
    expect(userContent(adapter.invocations[0]!)).toContain('Tool: sunny, 72F');
  });

  it('reports llm type as harness-chat-model', () => {
    const model = new HarnessChatModel({ adapter: new StubAdapter() });
    expect(model._llmType()).toBe('harness-chat-model');
  });

  it('propagates adapter errors', async () => {
    const failingAdapter: AgentAdapter = {
      type: 'claude-sdk',
      capabilities: CAPABILITY_MATRIX['claude-sdk'],
      workdir: '/tmp',
      async invoke() {
        throw new Error('adapter failure');
      },
      // eslint-disable-next-line require-yield
      async *stream() {},
    };
    const model = new HarnessChatModel({ adapter: failingAdapter });
    await expect(model.invoke([new HumanMessage('x')])).rejects.toThrow('adapter failure');
  });
});

describe('HarnessChatModel inside a LangGraph node', () => {
  it('a graph node can call the model and return its response in state', async () => {
    const adapter = new StubAdapter('graph-saw-this-from-LLM');
    const model = new HarnessChatModel({ adapter });

    const State = Annotation.Root({
      input: Annotation<string>,
      output: Annotation<string>,
    });
    const builder = new StateGraph(State)
      .addNode('llm-node', async (state) => {
        const response = await model.invoke([new HumanMessage(state.input)]);
        return { output: typeof response.content === 'string' ? response.content : '' };
      })
      .addEdge(START, 'llm-node')
      .addEdge('llm-node', END);
    const compiled = builder.compile() as unknown as CompiledGraph;

    const result = await compiled.invoke({ input: 'tell me a fact' });
    expect(result.output).toBe('graph-saw-this-from-LLM');
    expect(adapter.invocations).toHaveLength(1);
    expect(userContent(adapter.invocations[0]!)).toBe('tell me a fact');
  });
});

describe('createHarnessChatModel — createAgent helper', () => {
  it('builds a HarnessChatModel from an AgentSpec via createAgent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hcm-'));
    execFileSync('git', ['-C', dir, 'init'], { stdio: 'ignore' });
    const model = createHarnessChatModel({
      spec: { type: 'claude-sdk', model: 'claude-haiku-4-5', apiKey: 'sk-ant-stub' },
      workdir: dir,
    });
    expect(model).toBeInstanceOf(HarnessChatModel);
    expect(model._llmType()).toBe('harness-chat-model');
  });
});
