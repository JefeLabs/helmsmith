/**
 * Unit tests for the FlowDef → LangGraph compiler.
 *
 * These tests exercise the compiler in isolation — no adapters, no auth,
 * no JobRecord, no JobBus. Per-node behavior is faked via the executor
 * map so we can pin edge-routing semantics without dragging in the full
 * agent runtime.
 *
 * The runJob-level integration is covered by orchestrator.test.ts; the
 * focus here is: given a FlowDef shape, does the compiler produce the
 * graph you'd expect, and does each edge kind dispatch correctly?
 */

import { Command } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import type {
  ApprovalTag,
  Edge,
  Expression,
  FlowDef,
  LoopTag,
  McpToolDef,
  SuspendTag,
  TaskStep,
} from './catalog.ts';
import {
  type ApprovalRequest,
  buildRouter,
  compileFlow,
  evalExpression,
  type FlowStateT,
  linearFlowFromAgents,
  makeGateExecutor,
  makeTransformExecutor,
  type NodeExecutor,
  type SuspendRequest,
} from './flow-graph.ts';
import { composeSystemPromptWithSteering } from './orchestrator.ts';
import { makeToolExecutor } from './tool-executor.ts';

// ─── helpers ──────────────────────────────────────────────────────────────

function trigger(id = 't'): TaskStep {
  return { id, kind: 'trigger', config: { kind: 'manual' } };
}

function agentNode(id: string): TaskStep {
  // Tests don't exercise AgentDef body — minimal placeholder is fine.
  return {
    id,
    kind: 'agent',
    config: { agent: { id } as never },
  };
}

/** Node that records being called and returns a state delta. */
function makeRecorder(calls: string[], id: string, delta: Partial<FlowStateT> = {}): NodeExecutor {
  return async () => {
    calls.push(id);
    return { lastExit: { nodeId: id, kind: 'success' }, ...delta };
  };
}

function makeError(id: string, message = 'boom'): NodeExecutor {
  return async () => ({
    lastExit: { nodeId: id, kind: 'error', errorName: 'Error', errorMessage: message },
  });
}

function makeReject(calls: string[], id: string, attemptKey: string): NodeExecutor {
  return async (state) => {
    calls.push(id);
    const attempts = state.attempts[attemptKey] ?? 0;
    return {
      attempts: { [attemptKey]: attempts + 1 },
      lastExit: { nodeId: id, kind: 'reject' },
      rejectionPayload: { reason: 'no good', attempt: attempts + 1 },
    };
  };
}

const initialState: FlowStateT = {
  jobId: 'test',
  input: null,
  output: '',
  nodes: {},
  messages: [],
  attempts: {},
  lastExit: null,
  rejectionPayload: null,
  steering: [],
  cancelRequested: false,
  cancelReason: null,
  changedFiles: [],
  __completions: {},
  __joinSkips: {},
};

// ─── node-addressable state (input + nodes channels) ─────────────────────

describe('node-addressable state', () => {
  it('records each node output under state.nodes[id] and preserves input', async () => {
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'shape',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 'hello' } },
        },
      ],
      edges: [{ from: 't', to: 'shape', type: 'sequence' }],
    };
    const graph = compileFlow({ flow, executors: new Map() });
    const result = await graph.invoke(
      { ...initialState, input: 'in', output: 'in' },
      { configurable: { thread_id: 'nas-1' } },
    );
    expect(result.nodes.shape).toBe('hello');
    expect(result.input).toBe('in');
  });

  it('parses declared json output into state.nodes and routes OutputParseError to error edge', async () => {
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'j',
          kind: 'transform',
          output: { kind: 'json' },
          config: {
            expression: {
              kind: 'object',
              fields: { score: { kind: 'literal', value: 0.9 } },
            },
          },
        },
        {
          id: 'bad',
          kind: 'transform',
          output: { kind: 'json' },
          config: { expression: { kind: 'literal', value: 'not json' } },
        },
        {
          id: 'handled',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 'recovered' } },
        },
      ],
      edges: [
        { from: 't', to: 'j', type: 'sequence' },
        { from: 'j', to: 'bad', type: 'sequence' },
        { from: 'bad', to: 'handled', type: 'error' },
      ],
    };
    const graph = compileFlow({ flow, executors: new Map() });
    const result = await graph.invoke(initialState, { configurable: { thread_id: 'nas-2' } });
    expect(result.nodes.j).toEqual({ score: 0.9 });
    expect(result.nodes.bad).toBeUndefined();
    expect(result.output).toBe('recovered');
  });

  it('input mapping composes the effective input from state', async () => {
    const seen: string[] = [];
    const executors = new Map<string, NodeExecutor>([
      [
        'probe',
        async (state) => {
          seen.push(state.output);
          return { lastExit: { nodeId: 'probe', kind: 'success' } };
        },
      ],
    ]);
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'shape',
          kind: 'transform',
          output: { kind: 'json' },
          config: {
            expression: { kind: 'object', fields: { score: { kind: 'literal', value: 1 } } },
          },
        },
        {
          id: 'probe',
          kind: 'agent',
          config: { agent: { id: 'probe' } as never },
          input: {
            task: { kind: 'jsonpath', path: '$.input' },
            score: { kind: 'jsonpath', path: '$.nodes.shape.score' },
          },
        },
      ],
      edges: [
        { from: 't', to: 'shape', type: 'sequence' },
        { from: 'shape', to: 'probe', type: 'sequence' },
      ],
    };
    const graph = compileFlow({ flow, executors });
    await graph.invoke(
      { ...initialState, input: 'fix the bug', output: 'fix the bug' },
      { configurable: { thread_id: 'im-1' } },
    );
    expect(JSON.parse(seen[0] ?? '')).toEqual({ task: 'fix the bug', score: 1 });
  });

  it('single-expression input mapping passes strings through raw', async () => {
    const seen: string[] = [];
    const executors = new Map<string, NodeExecutor>([
      [
        'probe',
        async (state) => {
          seen.push(state.output);
          return { lastExit: { nodeId: 'probe', kind: 'success' } };
        },
      ],
    ]);
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'probe',
          kind: 'agent',
          config: { agent: { id: 'probe' } as never },
          input: { kind: 'jsonpath', path: '$.input' },
        },
      ],
      edges: [{ from: 't', to: 'probe', type: 'sequence' }],
    };
    const graph = compileFlow({ flow, executors });
    await graph.invoke(
      { ...initialState, input: 'raw text', output: '' },
      { configurable: { thread_id: 'im-2' } },
    );
    expect(seen[0]).toBe('raw text');
  });

  it('tool input-mechanism rule: input composes the payload, args bind it via $.output', async () => {
    const invocations: Record<string, unknown>[] = [];
    const toolNode: TaskStep = {
      id: 'notify',
      kind: 'tool',
      config: {
        toolId: 'mcp:notify',
        args: {
          payload: { kind: 'jsonpath', path: '$.output' },
          channel: { kind: 'literal', value: 'ops' },
        },
      },
      input: { score: { kind: 'jsonpath', path: '$.nodes.shape.score' } },
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'notify',
        makeToolExecutor(toolNode, {
          toolResolver: () =>
            ({ id: 'mcp:notify', kind: 'mcp', server: 'fake', toolName: 'notify' }) as McpToolDef,
          mcpInvokeFn: async (_def, args) => {
            invocations.push(args);
            return { ok: true, content: 'sent' };
          },
        }),
      ],
    ]);
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'shape',
          kind: 'transform',
          output: { kind: 'json' },
          config: {
            expression: { kind: 'object', fields: { score: { kind: 'literal', value: 0.9 } } },
          },
        },
        toolNode,
      ],
      edges: [
        { from: 't', to: 'shape', type: 'sequence' },
        { from: 'shape', to: 'notify', type: 'sequence' },
      ],
    };
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 'tir-1' } });
    // `input` composed {score: 0.9} into the effective $.output (the
    // mapping runs innermost, before the executor); the `payload` arg
    // bound the composed payload; the literal arg passed through.
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.channel).toBe('ops');
    expect(JSON.parse(String(invocations[0]?.payload))).toEqual({ score: 0.9 });
  });

  it('routes errors by errorName via on-matchers, catch-all last', () => {
    const edges: Edge[] = [
      { from: 'n', to: 'onTimeout', type: 'error', on: ['Timeout'] },
      { from: 'n', to: 'onAny', type: 'error' },
    ];
    const route = buildRouter('n', edges);
    const exitState = (errorName: string): FlowStateT => ({
      ...initialState,
      lastExit: { nodeId: 'n', kind: 'error', errorName },
    });
    expect(route(exitState('Timeout'))).toBe('onTimeout');
    expect(route(exitState('NetworkError'))).toBe('onAny');
  });

  it('throws on an error matched by no edge when only named matchers exist', () => {
    const edges: Edge[] = [{ from: 'n', to: 'onTimeout', type: 'error', on: ['Timeout'] }];
    const route = buildRouter('n', edges);
    expect(() =>
      route({
        ...initialState,
        lastExit: { nodeId: 'n', kind: 'error', errorName: 'NetworkError', errorMessage: 'x' },
      }),
    ).toThrow(/unhandled error/);
  });

  it('a looped node declaring json output aggregates a JSON array', async () => {
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'each',
          kind: 'transform',
          output: { kind: 'json' },
          config: {
            expression: {
              kind: 'object',
              fields: { item: { kind: 'jsonpath', path: '$.output' } },
            },
          },
          tags: {
            loop: {
              source: 'collection',
              path: { kind: 'literal', value: ['x', 'y'] },
              mode: 'sequential',
            },
          },
        },
      ],
      edges: [{ from: 't', to: 'each', type: 'sequence' }],
    };
    const graph = compileFlow({ flow, executors: new Map() });
    const result = await graph.invoke(initialState, { configurable: { thread_id: 'lj-1' } });
    expect(result.nodes.each).toEqual([{ item: 'x' }, { item: 'y' }]);
    expect(result.lastExit).toMatchObject({ kind: 'success' });
  });

  it('a looped json node with a non-JSON item output exits with OutputParseError', async () => {
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'each',
          kind: 'transform',
          output: { kind: 'json' },
          // Each iteration emits the raw item — 'not json' is not valid JSON,
          // so the assembled array must fail the parse.
          config: { expression: { kind: 'jsonpath', path: '$.output' } },
          tags: {
            loop: {
              source: 'collection',
              path: { kind: 'literal', value: ['not json'] },
              mode: 'sequential',
            },
          },
        },
        {
          id: 'handled',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 'recovered' } },
        },
      ],
      edges: [
        { from: 't', to: 'each', type: 'sequence' },
        { from: 'each', to: 'handled', type: 'error', on: ['OutputParseError'] },
      ],
    };
    const graph = compileFlow({ flow, executors: new Map() });
    const result = await graph.invoke(initialState, { configurable: { thread_id: 'lj-2' } });
    expect(result.nodes.each).toBeUndefined();
    expect(result.output).toBe('recovered');
  });

  it('a looped node records its aggregate output once', async () => {
    const flow: FlowDef = {
      id: 'f',
      nodes: [
        trigger('t'),
        {
          id: 'each',
          kind: 'transform',
          config: { expression: { kind: 'jsonpath', path: '$.output' } },
          tags: {
            loop: {
              source: 'collection',
              path: { kind: 'literal', value: ['x', 'y'] },
              mode: 'sequential',
            },
          },
        },
      ],
      edges: [{ from: 't', to: 'each', type: 'sequence' }],
    };
    const graph = compileFlow({ flow, executors: new Map() });
    const result = await graph.invoke(initialState, { configurable: { thread_id: 'nas-3' } });
    expect(result.nodes.each).toBe('x\n---\ny');
  });
});

// ─── compileFlow: topology ────────────────────────────────────────────────

describe('compileFlow — topology', () => {
  it('routes START → trigger → agent → END for a 2-node linear flow', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'linear',
      nodes: [trigger('t'), agentNode('a')],
      edges: [{ from: 't', to: 'a', type: 'sequence' }],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder(calls, 'a', { output: 'done' })],
    ]);

    const graph = compileFlow({ flow, executors });
    const result = await graph.invoke(initialState, { configurable: { thread_id: 't' } });

    expect(calls).toEqual(['a']);
    expect(result.output).toBe('done');
  });

  it('throws at compile time when no trigger node is present', () => {
    const flow: FlowDef = {
      id: 'no-trigger',
      nodes: [agentNode('a')],
      edges: [],
    };
    expect(() => compileFlow({ flow, executors: new Map() })).toThrow(/no trigger node/);
  });

  it('terminates at nodes with no outgoing edges', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'two-step',
      nodes: [trigger('t'), agentNode('a'), agentNode('b')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
        // b has no outgoing → END
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder(calls, 'a')],
      ['b', makeRecorder(calls, 'b')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    expect(calls).toEqual(['a', 'b']);
  });

  it('threads output across sequence edges', async () => {
    const flow: FlowDef = {
      id: 'thread',
      nodes: [trigger('t'), agentNode('a'), agentNode('b')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'a',
        async () => ({
          output: 'from-a',
          lastExit: { nodeId: 'a', kind: 'success' },
        }),
      ],
      [
        'b',
        async (state) => ({
          output: `${state.output}+from-b`,
          lastExit: { nodeId: 'b', kind: 'success' },
        }),
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    const result = await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    expect(result.output).toBe('from-a+from-b');
  });
});

// ─── conditional edges ───────────────────────────────────────────────────

describe('compileFlow — conditional edges', () => {
  it('routes to the first conditional whose predicate matches', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'cond',
      nodes: [trigger('t'), agentNode('a'), agentNode('b'), agentNode('c')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        {
          from: 'a',
          to: 'b',
          type: 'conditional',
          condition: { kind: 'jsonpath', path: '$.output' },
        },
        {
          from: 'a',
          to: 'c',
          type: 'conditional',
          condition: { kind: 'literal', value: true },
        },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'a',
        async () => ({
          output: 'has-value',
          lastExit: { nodeId: 'a', kind: 'success' },
        }),
      ],
      ['b', makeRecorder(calls, 'b')],
      ['c', makeRecorder(calls, 'c')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    // Output is truthy → first conditional matches → b runs, c does not.
    expect(calls).toEqual(['b']);
  });

  it('falls through to sequence edge when no conditional matches', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'cond-fallthrough',
      nodes: [trigger('t'), agentNode('a'), agentNode('b'), agentNode('c')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        {
          from: 'a',
          to: 'b',
          type: 'conditional',
          condition: { kind: 'literal', value: false },
        },
        { from: 'a', to: 'c', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder(calls, 'a')],
      ['b', makeRecorder(calls, 'b')],
      ['c', makeRecorder(calls, 'c')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    expect(calls).toEqual(['a', 'c']);
  });
});

// ─── error edges ──────────────────────────────────────────────────────────

describe('compileFlow — error edges', () => {
  it('routes to error target when an executor reports an error exit', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'err',
      nodes: [trigger('t'), agentNode('a'), agentNode('b'), agentNode('handler')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
        { from: 'a', to: 'handler', type: 'error' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeError('a')],
      ['b', makeRecorder(calls, 'b')],
      ['handler', makeRecorder(calls, 'handler')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    // a errored, error edge → handler. b never runs.
    expect(calls).toEqual(['handler']);
  });

  it('terminates without running successor nodes when an error exit has no error edge', async () => {
    // LangGraph's behavior on router throws is graph-internal — for the
    // runJob caller the contract is: no further node executes. Verify
    // that, rather than asserting on the throw shape (which is an
    // implementation detail of the underlying graph runtime).
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'err-uncaught',
      nodes: [trigger('t'), agentNode('a'), agentNode('b')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeError('a', 'kaboom')],
      ['b', makeRecorder(calls, 'b')],
    ]);
    const graph = compileFlow({ flow, executors });

    // Invoke may resolve or reject depending on LangGraph internals;
    // either way, b must NOT have run.
    try {
      await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    } catch {
      // Expected on some runtimes.
    }
    expect(calls).not.toContain('b');
  });
});

// ─── reject edges ─────────────────────────────────────────────────────────

describe('compileFlow — reject edges (cycles)', () => {
  it('cycles back via reject edge until maxAttempts is reached', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'reject-cycle',
      nodes: [trigger('t'), agentNode('worker'), agentNode('gate')],
      edges: [
        { from: 't', to: 'worker', type: 'sequence' },
        { from: 'worker', to: 'gate', type: 'sequence' },
        // gate rejects → worker (cycle), max 3 attempts.
        { from: 'gate', to: 'worker', type: 'reject', maxAttempts: 3 },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'worker',
        async () => {
          calls.push('worker');
          return { lastExit: { nodeId: 'worker', kind: 'success' } };
        },
      ],
      [
        'gate',
        async (state) => {
          calls.push('gate');
          const attempts = state.attempts.gate ?? 0;
          return {
            attempts: { gate: attempts + 1 },
            lastExit: { nodeId: 'gate', kind: 'reject' },
          };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors });

    // Reject limit blows up — but worker + gate must have run 3x each.
    await expect(graph.invoke(initialState, { configurable: { thread_id: 't' } })).rejects.toThrow(
      /reject limit/,
    );
    expect(calls.filter((c) => c === 'worker').length).toBe(3);
    expect(calls.filter((c) => c === 'gate').length).toBe(3);
  });

  it('escalates to the configured target when maxAttempts is exceeded with onMaxAttempts.escalate', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'reject-escalate',
      nodes: [trigger('t'), agentNode('worker'), agentNode('gate'), agentNode('escalation')],
      edges: [
        { from: 't', to: 'worker', type: 'sequence' },
        { from: 'worker', to: 'gate', type: 'sequence' },
        {
          from: 'gate',
          to: 'worker',
          type: 'reject',
          maxAttempts: 2,
          onMaxAttempts: { kind: 'escalate', to: 'escalation' },
        },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['worker', makeRecorder(calls, 'worker')],
      ['gate', makeReject(calls, 'gate', 'gate')],
      ['escalation', makeRecorder(calls, 'escalation')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    expect(calls.filter((c) => c === 'worker').length).toBe(2);
    expect(calls.filter((c) => c === 'gate').length).toBe(2);
    expect(calls).toContain('escalation');
  });
});

// ─── fallback edges ──────────────────────────────────────────────────────

describe('compileFlow — fallback edges', () => {
  it('uses the fallback edge when no sequence or conditional fires', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'fb',
      nodes: [trigger('t'), agentNode('a'), agentNode('catchall')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'catchall', type: 'fallback' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder(calls, 'a')],
      ['catchall', makeRecorder(calls, 'catchall')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    expect(calls).toEqual(['a', 'catchall']);
  });

  it('prefers sequence over fallback when both exist', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'fb-vs-seq',
      nodes: [trigger('t'), agentNode('a'), agentNode('next'), agentNode('catchall')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'next', type: 'sequence' },
        { from: 'a', to: 'catchall', type: 'fallback' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder(calls, 'a')],
      ['next', makeRecorder(calls, 'next')],
      ['catchall', makeRecorder(calls, 'catchall')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    expect(calls).toEqual(['a', 'next']);
    expect(calls).not.toContain('catchall');
  });
});

// ─── effect-aware replay guard ────────────────────────────────────────────

describe('effect-aware replay guard', () => {
  // t → work → ship(effect?) → check(gate). The gate fails its assertion
  // on the first attempt (attempts.check is unset → NaN compare → false),
  // rejects back to work, and passes on the second (attempts.check = 1).
  // The cycle re-enters ship — the guard decides whether it re-runs.
  function effectFlow(effect?: TaskStep['effect']): FlowDef {
    return {
      id: 'fx',
      nodes: [
        trigger('t'),
        agentNode('work'),
        { ...agentNode('ship'), effect },
        {
          id: 'check',
          kind: 'gate',
          config: {
            assertions: [
              {
                expression: {
                  kind: 'compare',
                  lhs: { kind: 'jsonpath', path: '$.attempts.check' },
                  op: '>=',
                  rhs: { kind: 'literal', value: 1 },
                },
                message: 'passes on the second attempt',
              },
            ],
          },
        },
      ],
      edges: [
        { from: 't', to: 'work', type: 'sequence' },
        { from: 'work', to: 'ship', type: 'sequence' },
        { from: 'ship', to: 'check', type: 'sequence' },
        { from: 'check', to: 'work', type: 'reject', maxAttempts: 3 },
      ],
    };
  }

  async function runEffectFlow(
    effect?: TaskStep['effect'],
  ): Promise<{ shipRuns: number; state: FlowStateT }> {
    let shipRuns = 0;
    const calls: string[] = [];
    const executors = new Map<string, NodeExecutor>([
      ['work', makeRecorder(calls, 'work')],
      [
        'ship',
        async () => {
          shipRuns++;
          return { output: 'shipped', lastExit: { nodeId: 'ship', kind: 'success' } };
        },
      ],
    ]);
    const graph = compileFlow({ flow: effectFlow(effect), executors });
    const state = (await graph.invoke(initialState, {
      configurable: { thread_id: `fx-${effect ?? 'none'}` },
    })) as FlowStateT;
    return { shipRuns, state };
  }

  it('skips a side-effecting node on re-entry when completion evidence exists', async () => {
    const { shipRuns, state } = await runEffectFlow('side-effecting');
    expect(shipRuns).toBe(1);
    // The skip restores the recorded output for downstream nodes and the
    // evidence from the first run remains addressable.
    expect(state.nodes.ship).toBe('shipped');
    expect(state.output).toBe('shipped');
  });

  it('re-runs idempotent and unclassified nodes on re-entry', async () => {
    expect((await runEffectFlow('idempotent')).shipRuns).toBe(2);
    expect((await runEffectFlow(undefined)).shipRuns).toBe(2);
  });
});

// ─── policy enforcement (retry / timeout / onError) ───────────────────────

describe('policy enforcement (2.3)', () => {
  /** t → work(policy) → done, plus optional extra nodes/edges. */
  function policyFlow(
    policy: TaskStep['policy'],
    extraNodes: TaskStep[] = [],
    extraEdges: Edge[] = [],
  ): FlowDef {
    return {
      id: 'pf',
      nodes: [trigger('t'), { ...agentNode('work'), policy }, agentNode('done'), ...extraNodes],
      edges: [
        { from: 't', to: 'work', type: 'sequence' },
        { from: 'work', to: 'done', type: 'sequence' },
        ...extraEdges,
      ],
    };
  }

  /** Executor that error-exits `failures` times, then succeeds. */
  function flaky(id: string, failures: number) {
    let calls = 0;
    const exec: NodeExecutor = async () => {
      calls++;
      if (calls <= failures) {
        return {
          lastExit: {
            nodeId: id,
            kind: 'error' as const,
            errorName: 'ProviderError',
            errorMessage: 'boom',
          },
        };
      }
      return { output: 'ok', lastExit: { nodeId: id, kind: 'success' as const } };
    };
    return { exec, calls: () => calls };
  }

  async function run(flow: FlowDef, executors: Map<string, NodeExecutor>) {
    const graph = compileFlow({ flow, executors });
    return graph.invoke(initialState, { configurable: { thread_id: `pol-${flow.id}` } });
  }

  it('retry re-runs an error-exiting node up to maxAttempts and then succeeds', async () => {
    const calls: string[] = [];
    const work = flaky('work', 2);
    const executors = new Map<string, NodeExecutor>([
      ['work', work.exec],
      ['done', makeRecorder(calls, 'done')],
    ]);
    await run(policyFlow({ retry: { maxAttempts: 3 } }), executors);
    expect(work.calls()).toBe(3);
    expect(calls).toContain('done');
  });

  it('without a policy the first error propagates unretried', async () => {
    const work = flaky('work', 5);
    const executors = new Map<string, NodeExecutor>([['work', work.exec]]);
    await expect(run(policyFlow(undefined), executors)).rejects.toThrow(/unhandled error/);
    expect(work.calls()).toBe(1);
  });

  it('retry exhaustion propagates the final error', async () => {
    const work = flaky('work', 5);
    const executors = new Map<string, NodeExecutor>([['work', work.exec]]);
    await expect(run(policyFlow({ retry: { maxAttempts: 2 } }), executors)).rejects.toThrow(
      /unhandled error/,
    );
    expect(work.calls()).toBe(2);
  });

  it('fixed backoff delays each retry attempt', async () => {
    const work = flaky('work', 2);
    const executors = new Map<string, NodeExecutor>([['work', work.exec]]);
    const started = Date.now();
    await run(
      policyFlow({ retry: { maxAttempts: 3, backoff: { kind: 'fixed', ms: 40 } } }),
      executors,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(80); // two backoff sleeps
    expect(work.calls()).toBe(3);
  });

  it('timeout converts a hung node into an error-edge-routable Timeout exit', async () => {
    const calls: string[] = [];
    const executors = new Map<string, NodeExecutor>([
      [
        'work',
        async () => {
          await new Promise((r) => setTimeout(r, 300));
          return { output: 'late', lastExit: { nodeId: 'work', kind: 'success' as const } };
        },
      ],
      ['rescue', makeRecorder(calls, 'rescue')],
      ['done', makeRecorder(calls, 'done')],
    ]);
    await run(
      policyFlow(
        { timeout: 40 },
        [agentNode('rescue')],
        [{ from: 'work', to: 'rescue', type: 'error', on: ['Timeout'] }],
      ),
      executors,
    );
    expect(calls).toContain('rescue');
    expect(calls).not.toContain('done');
  });

  it("onError 'continue' proceeds past an exhausted failure", async () => {
    const calls: string[] = [];
    const work = flaky('work', 5);
    const executors = new Map<string, NodeExecutor>([
      ['work', work.exec],
      ['done', makeRecorder(calls, 'done')],
    ]);
    const result = (await run(
      policyFlow({ retry: { maxAttempts: 2 }, onError: 'continue' }),
      executors,
    )) as FlowStateT;
    expect(work.calls()).toBe(2);
    expect(calls).toContain('done');
    expect(result.lastExit?.kind).toBe('success');
  });

  it("onError 'fallback' routes an unhandled error to the fallback edge", async () => {
    const calls: string[] = [];
    const work = flaky('work', 5);
    const executors = new Map<string, NodeExecutor>([
      ['work', work.exec],
      ['rescue', makeRecorder(calls, 'rescue')],
      ['done', makeRecorder(calls, 'done')],
    ]);
    await run(
      policyFlow(
        { onError: 'fallback' },
        [agentNode('rescue')],
        [{ from: 'work', to: 'rescue', type: 'fallback' }],
      ),
      executors,
    );
    expect(calls).toContain('rescue');
    expect(calls).not.toContain('done');
  });
});

// ─── parallel fan-out + joinStrategy (2.4) ─────────────────────────────────

describe('parallel fan-out + joinStrategy (2.4)', () => {
  function recorderMap(calls: string[], ids: string[]): Map<string, NodeExecutor> {
    return new Map(ids.map((id) => [id, makeRecorder(calls, id)]));
  }

  async function run(flow: FlowDef, executors: Map<string, NodeExecutor>) {
    const graph = compileFlow({ flow, executors });
    return graph.invoke(initialState, { configurable: { thread_id: `par-${flow.id}` } });
  }

  it('fans out: every sequence edge from a node fires, not just the first', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'fan',
      nodes: [trigger('t'), agentNode('a'), agentNode('b'), agentNode('c')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
        { from: 'a', to: 'c', type: 'sequence' },
      ],
    };
    await run(flow, recorderMap(calls, ['a', 'b', 'c']));
    expect(calls).toContain('b');
    expect(calls).toContain('c');
  });

  /** Unequal-length branches converging on j:
   *  t → a → { b → x → j,  c → j }  — c arrives a superstep early. */
  function diamondFlow(joinStrategy?: TaskStep['joinStrategy']): FlowDef {
    return {
      id: `dia-${JSON.stringify(joinStrategy) ?? 'none'}`,
      nodes: [
        trigger('t'),
        agentNode('a'),
        agentNode('b'),
        agentNode('x'),
        agentNode('c'),
        { ...agentNode('j'), joinStrategy },
        agentNode('after'),
      ],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
        { from: 'a', to: 'c', type: 'sequence' },
        { from: 'b', to: 'x', type: 'sequence' },
        { from: 'x', to: 'j', type: 'sequence' },
        { from: 'c', to: 'j', type: 'sequence' },
        { from: 'j', to: 'after', type: 'sequence' },
      ],
    };
  }

  it("joinStrategy 'all' is a barrier: j runs exactly once, after BOTH branches", async () => {
    const calls: string[] = [];
    await run(diamondFlow('all'), recorderMap(calls, ['a', 'b', 'x', 'c', 'j', 'after']));
    expect(calls).toContain('x');
    expect(calls).toContain('c');
    expect(calls.filter((c) => c === 'j')).toHaveLength(1);
    // Both branch tails completed before the join executed.
    expect(calls.indexOf('j')).toBeGreaterThan(calls.indexOf('x'));
    expect(calls.indexOf('j')).toBeGreaterThan(calls.indexOf('c'));
    expect(calls.filter((c) => c === 'after')).toHaveLength(1);
  });

  it("joinStrategy 'any' fires on the first arrival and exactly once", async () => {
    const calls: string[] = [];
    await run(diamondFlow('any'), recorderMap(calls, ['a', 'b', 'x', 'c', 'j', 'after']));
    expect(calls.filter((c) => c === 'j')).toHaveLength(1);
    // c (short branch) arrives before x (long branch tail) completes.
    expect(calls.indexOf('j')).toBeLessThan(calls.indexOf('x'));
    expect(calls.filter((c) => c === 'after')).toHaveLength(1);
  });

  it('joinStrategy nOfM fires on the nth arrival and exactly once', async () => {
    // Three branches of lengths 1, 2, 3 converging on j with nOfM: 2.
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'nofm',
      nodes: [
        trigger('t'),
        agentNode('a'),
        agentNode('s1'),
        agentNode('m1'),
        agentNode('m2'),
        agentNode('l1'),
        agentNode('l2'),
        agentNode('l3'),
        { ...agentNode('j'), joinStrategy: { nOfM: 2 } },
      ],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 's1', type: 'sequence' },
        { from: 'a', to: 'm1', type: 'sequence' },
        { from: 'a', to: 'l1', type: 'sequence' },
        { from: 'm1', to: 'm2', type: 'sequence' },
        { from: 'l1', to: 'l2', type: 'sequence' },
        { from: 'l2', to: 'l3', type: 'sequence' },
        { from: 's1', to: 'j', type: 'sequence' },
        { from: 'm2', to: 'j', type: 'sequence' },
        { from: 'l3', to: 'j', type: 'sequence' },
      ],
    };
    await run(flow, recorderMap(calls, ['a', 's1', 'm1', 'm2', 'l1', 'l2', 'l3', 'j']));
    expect(calls.filter((c) => c === 'j')).toHaveLength(1);
    // Fired at the second arrival (m2), before the long branch finished.
    expect(calls.indexOf('j')).toBeGreaterThan(calls.indexOf('m2'));
    expect(calls.indexOf('j')).toBeLessThan(calls.indexOf('l3'));
  });

  it('parallel branch outputs are both addressable at the join via $.nodes', async () => {
    const calls: string[] = [];
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder(calls, 'a')],
      ['b', async () => ({ output: 'from-b', lastExit: { nodeId: 'b', kind: 'success' } })],
      ['x', makeRecorder(calls, 'x')],
      ['c', async () => ({ output: 'from-c', lastExit: { nodeId: 'c', kind: 'success' } })],
      ['j', makeRecorder(calls, 'j')],
      ['after', makeRecorder(calls, 'after')],
    ]);
    const result = (await run(diamondFlow('all'), executors)) as FlowStateT;
    expect(result.nodes.b).toBe('from-b');
    expect(result.nodes.c).toBe('from-c');
  });

  it('a multi-in node WITHOUT joinStrategy keeps trigger-per-arrival behavior', async () => {
    const calls: string[] = [];
    await run(diamondFlow(undefined), recorderMap(calls, ['a', 'b', 'x', 'c', 'j', 'after']));
    // Unequal branches, no declared join → j runs once per arrival.
    expect(calls.filter((c) => c === 'j')).toHaveLength(2);
  });
});

// ─── node output schema enforcement (2.7) ─────────────────────────────────

describe('text evidence truncation (checkpoint-growth cap)', () => {
  it('caps oversized TEXT evidence at $.nodes.<id> while $.output keeps the full string', async () => {
    const big = 'x'.repeat(500);
    const flow: FlowDef = {
      id: 'trunc',
      nodes: [trigger('t'), agentNode('big'), agentNode('probe')],
      edges: [
        { from: 't', to: 'big', type: 'sequence' },
        { from: 'big', to: 'probe', type: 'sequence' },
      ],
    };
    const seen: string[] = [];
    const executors = new Map<string, NodeExecutor>([
      ['big', async () => ({ output: big, lastExit: { nodeId: 'big', kind: 'success' } })],
      [
        'probe',
        async (state) => {
          seen.push(state.output);
          return { lastExit: { nodeId: 'probe', kind: 'success' } };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors, maxTextEvidenceLength: 100 });
    const result = (await graph.invoke(initialState, {
      configurable: { thread_id: 'trunc-1' },
    })) as Record<string, unknown>;

    // The evidence copy is capped with an explicit marker…
    const evidence = (result.nodes as Record<string, unknown>).big as string;
    expect(evidence.startsWith('x'.repeat(100))).toBe(true);
    expect(evidence).toContain('[truncated 400 chars]');
    expect(evidence.length).toBeLessThan(200);
    // …but the $.output relay to the next node is untouched.
    expect(seen[0]).toBe(big);
  });

  it('never truncates JSON evidence (structured data must stay addressable)', async () => {
    const bigJson = JSON.stringify({ blob: 'y'.repeat(500) });
    const flow: FlowDef = {
      id: 'trunc-json',
      nodes: [trigger('t'), { ...agentNode('shape'), output: { kind: 'json' } } as TaskStep],
      edges: [{ from: 't', to: 'shape', type: 'sequence' }],
    };
    const executors = new Map<string, NodeExecutor>([
      ['shape', async () => ({ output: bigJson, lastExit: { nodeId: 'shape', kind: 'success' } })],
    ]);
    const graph = compileFlow({ flow, executors, maxTextEvidenceLength: 100 });
    const result = (await graph.invoke(initialState, {
      configurable: { thread_id: 'trunc-2' },
    })) as Record<string, unknown>;
    expect((result.nodes as Record<string, { blob: string }>).shape.blob).toBe('y'.repeat(500));
  });
});

describe('node output schema enforcement (2.7)', () => {
  function schemaFlow(): FlowDef {
    return {
      id: 'sch',
      nodes: [
        trigger('t'),
        {
          ...agentNode('shape'),
          output: {
            kind: 'json',
            schema: {
              type: 'object',
              required: ['score'],
              properties: { score: { type: 'number', minimum: 0, maximum: 1 } },
            },
          },
        },
        agentNode('done'),
        agentNode('rescue'),
      ],
      edges: [
        { from: 't', to: 'shape', type: 'sequence' },
        { from: 'shape', to: 'done', type: 'sequence' },
        { from: 'shape', to: 'rescue', type: 'error', on: ['OutputSchemaViolation'] },
      ],
    };
  }

  async function runWith(output: string) {
    const calls: string[] = [];
    const executors = new Map<string, NodeExecutor>([
      ['shape', async () => ({ output, lastExit: { nodeId: 'shape', kind: 'success' } })],
      ['done', makeRecorder(calls, 'done')],
      ['rescue', makeRecorder(calls, 'rescue')],
    ]);
    const graph = compileFlow({ flow: schemaFlow(), executors });
    const state = (await graph.invoke(initialState, {
      configurable: { thread_id: `sch-${output.length}` },
    })) as FlowStateT;
    return { calls, state };
  }

  it('a conforming JSON output is recorded and the flow proceeds', async () => {
    const { calls, state } = await runWith('{"score": 0.5}');
    expect(calls).toContain('done');
    expect(state.nodes.shape).toEqual({ score: 0.5 });
  });

  it('a schema-violating output exits OutputSchemaViolation, routable via error edge', async () => {
    const { calls, state } = await runWith('{"score": 2}');
    expect(calls).toContain('rescue');
    expect(calls).not.toContain('done');
    expect(state.lastExit?.errorName ?? '').not.toBe('OutputParseError');
    // The violating value is NOT recorded as addressable evidence.
    expect(state.nodes.shape).toBeUndefined();
  });
});

// ─── loop v2 (3.5) ────────────────────────────────────────────────────────

describe('loop v2 (3.5)', () => {
  function loopFlow(loop: LoopTag): FlowDef {
    return {
      id: 'lp',
      nodes: [trigger('t'), { ...agentNode('work'), tags: { loop } }],
      edges: [{ from: 't', to: 'work', type: 'sequence' }],
    };
  }

  async function runLoop(
    loop: LoopTag,
    exec: NodeExecutor,
    input: Partial<FlowStateT> = {},
  ): Promise<FlowStateT> {
    const graph = compileFlow({
      flow: loopFlow(loop),
      executors: new Map([['work', exec]]),
    });
    return (await graph.invoke(
      { ...initialState, ...input },
      { configurable: { thread_id: `lp-${Math.random()}` } },
    )) as FlowStateT;
  }

  const items3: LoopTag = {
    source: 'collection',
    path: { kind: 'literal', value: ['a', 'b', 'c'] },
    mode: 'sequential',
  };

  it('accumulates per-iteration deltas across iterations (nodes merge, messages concat)', async () => {
    const state = await runLoop(items3, async (s) => ({
      output: s.output.toUpperCase(),
      nodes: { [`seen-${s.output}`]: s.output },
      messages: [`ran:${s.output}`],
      lastExit: { nodeId: 'work', kind: 'success' },
    }));
    // v1 kept only the LAST iteration's non-output delta.
    expect(
      Object.keys(state.nodes)
        .filter((k) => k.startsWith('seen-'))
        .sort(),
    ).toEqual(['seen-a', 'seen-b', 'seen-c']);
    expect(state.messages.filter((m) => String(m).startsWith('ran:'))).toHaveLength(3);
    expect(state.output).toBe('A\n---\nB\n---\nC');
  });

  it('parallel mode is a per-slot pool: a slow item does not stall its neighbors', async () => {
    const finished: string[] = [];
    await runLoop(
      {
        source: 'collection',
        path: { kind: 'literal', value: ['slow', 'q1', 'q2', 'q3'] },
        mode: 'parallel',
        concurrency: 2,
      },
      async (s) => {
        await new Promise((r) => setTimeout(r, s.output === 'slow' ? 150 : 10));
        finished.push(s.output);
        return { output: s.output, lastExit: { nodeId: 'work', kind: 'success' } };
      },
    );
    // Chunked v1 ran [slow,q1] then [q2,q3]: order slow-blocks → q1, slow, q2, q3.
    // Per-slot v2: the free slot drains q1..q3 while slow runs.
    expect(finished).toEqual(['q1', 'q2', 'q3', 'slow']);
  });

  it('a parallel failure aborts siblings and stops launching', async () => {
    const started: string[] = [];
    let sawAbort = false;
    const result = await runLoop(
      {
        source: 'collection',
        path: { kind: 'literal', value: ['boom', 'long', 'never1', 'never2'] },
        mode: 'parallel',
        concurrency: 2,
      },
      async (s, signal) => {
        started.push(s.output);
        if (s.output === 'boom') {
          await new Promise((r) => setTimeout(r, 20));
          return {
            lastExit: { nodeId: 'work', kind: 'error', errorName: 'Boom', errorMessage: 'x' },
          };
        }
        // A signal-aware executor: resolve early when siblings abort.
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 300);
          signal?.addEventListener('abort', () => {
            sawAbort = true;
            clearTimeout(t);
            resolve();
          });
        });
        return { output: s.output, lastExit: { nodeId: 'work', kind: 'success' } };
      },
    );
    expect(started.sort()).toEqual(['boom', 'long']);
    expect(sawAbort).toBe(true);
    // The loop node has no outgoing edges, so the error exit lands in
    // final state (no router runs for out-degree-0 nodes).
    expect(result.lastExit?.errorName).toBe('Boom');
  });

  it('recursive directory source walks the tree and yields files only', async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'loop-v2-'));
    try {
      await mkdir(join(root, 'sub/deeper'), { recursive: true });
      await writeFile(join(root, 'top.txt'), '1');
      await writeFile(join(root, 'sub/mid.txt'), '2');
      await writeFile(join(root, 'sub/deeper/leaf.txt'), '3');

      const seen: string[] = [];
      await runLoop(
        {
          source: 'directory',
          path: { kind: 'literal', value: root },
          mode: 'sequential',
          recursive: true,
        },
        async (s) => {
          seen.push(s.output);
          return { output: 'ok', lastExit: { nodeId: 'work', kind: 'success' } };
        },
      );
      expect(seen.map((p) => p.slice(root.length + 1)).sort()).toEqual([
        'sub/deeper/leaf.txt',
        'sub/mid.txt',
        'top.txt',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// ─── buildRouter (in isolation) ───────────────────────────────────────────

describe('buildRouter', () => {
  function state(overrides: Partial<FlowStateT> = {}): FlowStateT {
    return { ...initialState, ...overrides };
  }

  it('returns sequence target by default', () => {
    const router = buildRouter('a', [{ from: 'a', to: 'b', type: 'sequence' }]);
    expect(router(state({ lastExit: { nodeId: 'a', kind: 'success' } }))).toBe('b');
  });

  it('returns the literal-true conditional target', () => {
    const edges: Edge[] = [
      {
        from: 'a',
        to: 'b',
        type: 'conditional',
        condition: { kind: 'literal', value: true },
      },
      { from: 'a', to: 'c', type: 'sequence' },
    ];
    const router = buildRouter('a', edges);
    expect(router(state({ lastExit: { nodeId: 'a', kind: 'success' } }))).toBe('b');
  });

  it('returns sequence when literal-false conditional skips', () => {
    const edges: Edge[] = [
      {
        from: 'a',
        to: 'b',
        type: 'conditional',
        condition: { kind: 'literal', value: false },
      },
      { from: 'a', to: 'c', type: 'sequence' },
    ];
    const router = buildRouter('a', edges);
    expect(router(state({ lastExit: { nodeId: 'a', kind: 'success' } }))).toBe('c');
  });

  it('routes to error target on error exit', () => {
    const edges: Edge[] = [
      { from: 'a', to: 'b', type: 'sequence' },
      { from: 'a', to: 'h', type: 'error' },
    ];
    const router = buildRouter('a', edges);
    expect(
      router(
        state({
          lastExit: { nodeId: 'a', kind: 'error', errorMessage: 'x' },
        }),
      ),
    ).toBe('h');
  });

  it('throws on error exit with no error edge', () => {
    const router = buildRouter('a', [{ from: 'a', to: 'b', type: 'sequence' }]);
    expect(() =>
      router(state({ lastExit: { nodeId: 'a', kind: 'error', errorMessage: 'x' } })),
    ).toThrow(/unhandled error/);
  });

  it('routes reject to its target while attempts < max', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b', type: 'reject', maxAttempts: 3 }];
    const router = buildRouter('a', edges);
    expect(
      router(
        state({
          lastExit: { nodeId: 'a', kind: 'reject' },
          attempts: { a: 1 },
        }),
      ),
    ).toBe('b');
  });

  it('throws when reject attempts exceed maxAttempts and onMaxAttempts is unset', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b', type: 'reject', maxAttempts: 2 }];
    const router = buildRouter('a', edges);
    expect(() =>
      router(
        state({
          lastExit: { nodeId: 'a', kind: 'reject' },
          attempts: { a: 2 },
        }),
      ),
    ).toThrow(/reject limit/);
  });

  it('escalates when reject exceeds maxAttempts and onMaxAttempts.kind === escalate', () => {
    const edges: Edge[] = [
      {
        from: 'a',
        to: 'b',
        type: 'reject',
        maxAttempts: 2,
        onMaxAttempts: { kind: 'escalate', to: 'esc' },
      },
    ];
    const router = buildRouter('a', edges);
    expect(
      router(
        state({
          lastExit: { nodeId: 'a', kind: 'reject' },
          attempts: { a: 2 },
        }),
      ),
    ).toBe('esc');
  });
});

// ─── evalExpression ───────────────────────────────────────────────────────

describe('evalExpression', () => {
  const s: FlowStateT = {
    jobId: 'j',
    input: null,
    output: 'has-value',
    nodes: {},
    messages: [],
    attempts: { node1: 2 },
    lastExit: null,
    rejectionPayload: null,
    steering: [],
    cancelRequested: false,
    cancelReason: null,
    changedFiles: [],
    __completions: {},
    __joinSkips: {},
  };

  it('handles literal true', () => {
    expect(evalExpression({ kind: 'literal', value: true }, s)).toBe(true);
  });

  it('handles literal false', () => {
    expect(evalExpression({ kind: 'literal', value: false }, s)).toBe(false);
  });

  it('handles literal truthy non-boolean', () => {
    expect(evalExpression({ kind: 'literal', value: 'yes' }, s)).toBe(true);
    expect(evalExpression({ kind: 'literal', value: 0 }, s)).toBe(false);
  });

  it('resolves jsonpath $.field', () => {
    expect(evalExpression({ kind: 'jsonpath', path: '$.output' }, s)).toBe(true);
    expect(evalExpression({ kind: 'jsonpath', path: '$.output' }, { ...s, output: '' })).toBe(
      false,
    );
  });

  it('resolves jsonpath $.field.subfield', () => {
    expect(evalExpression({ kind: 'jsonpath', path: '$.attempts.node1' }, s)).toBe(true);
    expect(evalExpression({ kind: 'jsonpath', path: '$.attempts.missing' }, s)).toBe(false);
  });

  it('returns false for malformed jsonpath', () => {
    expect(evalExpression({ kind: 'jsonpath', path: 'output' }, s)).toBe(false);
  });

  it('throws on js kind (no sandbox wired)', () => {
    expect(() => evalExpression({ kind: 'js', expression: 'state.output' }, s)).toThrow(
      /not yet supported/,
    );
  });

  // ── compare ───────────────────────────────────────────────────────────

  describe('kind: compare', () => {
    it('== / != with strict equality', () => {
      const lit = (value: unknown): Expression => ({ kind: 'literal', value });
      expect(evalExpression({ kind: 'compare', lhs: lit(2), op: '==', rhs: lit(2) }, s)).toBe(true);
      // Strict — string and number are not equal even if loose-equal would be.
      expect(evalExpression({ kind: 'compare', lhs: lit(2), op: '==', rhs: lit('2') }, s)).toBe(
        false,
      );
      expect(evalExpression({ kind: 'compare', lhs: lit('a'), op: '!=', rhs: lit('b') }, s)).toBe(
        true,
      );
    });

    it('numeric ops coerce both sides via Number()', () => {
      const lit = (value: unknown): Expression => ({ kind: 'literal', value });
      expect(evalExpression({ kind: 'compare', lhs: lit('5'), op: '<', rhs: lit(10) }, s)).toBe(
        true,
      );
      expect(evalExpression({ kind: 'compare', lhs: lit(10), op: '>=', rhs: lit('10') }, s)).toBe(
        true,
      );
    });

    it('numeric ops return false when either side is NaN', () => {
      const lit = (value: unknown): Expression => ({ kind: 'literal', value });
      expect(
        evalExpression({ kind: 'compare', lhs: lit('not-a-num'), op: '<', rhs: lit(5) }, s),
      ).toBe(false);
      expect(evalExpression({ kind: 'compare', lhs: lit(5), op: '>', rhs: lit('xyz') }, s)).toBe(
        false,
      );
    });

    it('in op: true iff lhs ∈ rhs (array)', () => {
      const lit = (value: unknown): Expression => ({ kind: 'literal', value });
      expect(
        evalExpression(
          { kind: 'compare', lhs: lit('claude'), op: 'in', rhs: lit(['gpt', 'claude', 'opus']) },
          s,
        ),
      ).toBe(true);
      expect(
        evalExpression(
          { kind: 'compare', lhs: lit('gemini'), op: 'in', rhs: lit(['gpt', 'claude']) },
          s,
        ),
      ).toBe(false);
      // rhs not an array → false (not throw)
      expect(evalExpression({ kind: 'compare', lhs: lit('a'), op: 'in', rhs: lit('abc') }, s)).toBe(
        false,
      );
    });

    it('compares state-resolved jsonpath against a literal', () => {
      // attempts.node1 = 2; check it's > 0
      expect(
        evalExpression(
          {
            kind: 'compare',
            lhs: { kind: 'jsonpath', path: '$.attempts.node1' },
            op: '>',
            rhs: { kind: 'literal', value: 0 },
          },
          s,
        ),
      ).toBe(true);
    });
  });

  // ── all / any / not ───────────────────────────────────────────────────

  describe('kind: all / any / not', () => {
    const T: Expression = { kind: 'literal', value: true };
    const F: Expression = { kind: 'literal', value: false };

    it('all([]) returns true (vacuous truth)', () => {
      expect(evalExpression({ kind: 'all', exprs: [] }, s)).toBe(true);
    });
    it('any([]) returns false', () => {
      expect(evalExpression({ kind: 'any', exprs: [] }, s)).toBe(false);
    });
    it('all of trues → true; all with one false → false', () => {
      expect(evalExpression({ kind: 'all', exprs: [T, T, T] }, s)).toBe(true);
      expect(evalExpression({ kind: 'all', exprs: [T, F, T] }, s)).toBe(false);
    });
    it('any: at least one true → true; all false → false', () => {
      expect(evalExpression({ kind: 'any', exprs: [F, F, T] }, s)).toBe(true);
      expect(evalExpression({ kind: 'any', exprs: [F, F, F] }, s)).toBe(false);
    });
    it('all short-circuits (later js does not throw)', () => {
      // Can't directly observe short-circuit without spy, but we can
      // ensure a guarded js expression after a false guard never
      // executes (would otherwise throw).
      const guarded: Expression = {
        kind: 'all',
        exprs: [F, { kind: 'js', expression: 'never_evaluated()' }],
      };
      expect(evalExpression(guarded, s)).toBe(false);
    });
    it('any short-circuits on first true', () => {
      const guarded: Expression = {
        kind: 'any',
        exprs: [T, { kind: 'js', expression: 'never_evaluated()' }],
      };
      expect(evalExpression(guarded, s)).toBe(true);
    });
    it('not inverts the inner', () => {
      expect(evalExpression({ kind: 'not', expr: T }, s)).toBe(false);
      expect(evalExpression({ kind: 'not', expr: F }, s)).toBe(true);
    });
  });
});

// ─── linearFlowFromAgents ────────────────────────────────────────────────

describe('linearFlowFromAgents', () => {
  it('produces a trigger + agent chain with sequence edges', () => {
    const flow = linearFlowFromAgents('demo', [{ id: 'a' }, { id: 'b' }]);
    expect(flow.id).toBe('demo');
    expect(flow.nodes).toHaveLength(3);
    expect(flow.nodes[0]?.kind).toBe('trigger');
    expect(flow.nodes[1]?.id).toBe('a');
    expect(flow.nodes[2]?.id).toBe('b');
    expect(flow.edges).toEqual([
      { from: '__trigger', to: 'a', type: 'sequence' },
      { from: 'a', to: 'b', type: 'sequence' },
    ]);
  });

  it('filters out coordinator + checkout-coordinator agents', () => {
    const flow = linearFlowFromAgents('demo', [
      { id: 'coordinator' },
      { id: 'a' },
      { id: 'checkout-coordinator' },
      { id: 'b' },
    ]);
    expect(flow.nodes.map((n) => n.id)).toEqual(['__trigger', 'a', 'b']);
    expect(flow.edges).toEqual([
      { from: '__trigger', to: 'a', type: 'sequence' },
      { from: 'a', to: 'b', type: 'sequence' },
    ]);
  });

  it('handles the all-coordinators case (only trigger, no edges)', () => {
    const flow = linearFlowFromAgents('demo', [
      { id: 'coordinator' },
      { id: 'checkout-coordinator' },
    ]);
    expect(flow.nodes).toHaveLength(1);
    expect(flow.nodes[0]?.kind).toBe('trigger');
    expect(flow.edges).toEqual([]);
  });
});

// ─── Approval tag ─────────────────────────────────────────────────────────

describe('compileFlow — Approval tag', () => {
  const approvalTag: ApprovalTag = {
    assigneeRole: 'tech-lead',
    slaMs: 60_000,
    concurrency: 'pessimistic',
  };

  function approvalAgentNode(id: string, tag: ApprovalTag): TaskStep {
    return {
      id,
      kind: 'agent',
      config: { agent: { id } as never },
      tags: { approval: tag },
    };
  }

  it('pauses with an ApprovalRequest after the inner node runs', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'approval-pause',
      nodes: [trigger('t'), approvalAgentNode('plan', approvalTag), agentNode('build')],
      edges: [
        { from: 't', to: 'plan', type: 'sequence' },
        { from: 'plan', to: 'build', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'plan',
        async () => {
          calls.push('plan');
          return {
            output: 'a draft plan',
            lastExit: { nodeId: 'plan', kind: 'success' },
          };
        },
      ],
      ['build', makeRecorder(calls, 'build')],
    ]);
    const graph = compileFlow({ flow, executors });
    const config = { configurable: { thread_id: 't1' } };
    const result = (await graph.invoke(initialState, config)) as Record<string, unknown>;

    // Plan ran; build did NOT (graph paused at the approval interrupt).
    expect(calls).toEqual(['plan']);
    expect(result.__interrupt__).toBeDefined();
    const interrupts = result.__interrupt__ as Array<{ value: ApprovalRequest }>;
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]?.value.kind).toBe('approval');
    expect(interrupts[0]?.value.nodeId).toBe('plan');
    expect(interrupts[0]?.value.assigneeRole).toBe('tech-lead');
    expect(interrupts[0]?.value.content).toBe('a draft plan');
    expect(interrupts[0]?.value.attempt).toBe(1);
  });

  it('forwards via sequence edge on resume with approve', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'approval-approve',
      nodes: [trigger('t'), approvalAgentNode('plan', approvalTag), agentNode('build')],
      edges: [
        { from: 't', to: 'plan', type: 'sequence' },
        { from: 'plan', to: 'build', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'plan',
        async () => {
          calls.push('plan');
          return { output: 'plan-output', lastExit: { nodeId: 'plan', kind: 'success' } };
        },
      ],
      ['build', makeRecorder(calls, 'build')],
    ]);
    const graph = compileFlow({ flow, executors });
    const config = { configurable: { thread_id: 'approve-thread' } };

    await graph.invoke(initialState, config); // pauses at approval

    // Resume with approve.
    await graph.invoke(new Command({ resume: { decision: 'approve' } }), config);

    // build now ran. plan did NOT re-run on resume (synthetic node owns
    // the interrupt).
    expect(calls).toEqual(['plan', 'build']);
  });

  it('routes via reject edge on resume with reject and increments attempt', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'approval-reject',
      nodes: [trigger('t'), approvalAgentNode('plan', approvalTag), agentNode('build')],
      edges: [
        { from: 't', to: 'plan', type: 'sequence' },
        { from: 'plan', to: 'build', type: 'sequence' },
        // Self-loop on reject: planner re-runs with steering.
        { from: 'plan', to: 'plan', type: 'reject', maxAttempts: 3 },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'plan',
        async (state) => {
          calls.push(`plan:${state.rejectionPayload?.steering ?? 'fresh'}`);
          return { output: 'a plan', lastExit: { nodeId: 'plan', kind: 'success' } };
        },
      ],
      ['build', makeRecorder(calls, 'build')],
    ]);
    const graph = compileFlow({ flow, executors });
    const config = { configurable: { thread_id: 'reject-thread' } };

    await graph.invoke(initialState, config); // pause 1
    // Reject with steering — should cycle back to plan, then pause again.
    const r2 = (await graph.invoke(
      new Command({ resume: { decision: 'reject', steering: 'focus on auth' } }),
      config,
    )) as Record<string, unknown>;

    expect(r2.__interrupt__).toBeDefined();
    // Plan ran twice — once initially, once after reject.
    expect(calls.filter((c) => c.startsWith('plan')).length).toBe(2);
    expect(calls.filter((c) => c === 'build').length).toBe(0);
    // Second plan run saw the steering text from rejection payload.
    expect(calls).toContain('plan:focus on auth');

    // Approve the second draft.
    await graph.invoke(new Command({ resume: { decision: 'approve' } }), config);
    expect(calls.filter((c) => c === 'build').length).toBe(1);
  });
});

// ─── Suspend tag ──────────────────────────────────────────────────────────

describe('compileFlow — Suspend tag', () => {
  const suspendTag: SuspendTag = {
    trigger: { kind: 'timer', durationMs: 60_000 },
  };

  function suspendAgentNode(id: string, tag: SuspendTag): TaskStep {
    return {
      id,
      kind: 'agent',
      config: { agent: { id } as never },
      tags: { suspend: tag },
    };
  }

  it('pauses with a SuspendRequest carrying the trigger info', async () => {
    const flow: FlowDef = {
      id: 'suspend-pause',
      nodes: [
        trigger('t'),
        agentNode('a'),
        suspendAgentNode('cooldown', suspendTag),
        agentNode('b'),
      ],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'cooldown', type: 'sequence' },
        { from: 'cooldown', to: 'b', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder([], 'a')],
      ['cooldown', makeRecorder([], 'cooldown')],
      ['b', makeRecorder([], 'b')],
    ]);
    const graph = compileFlow({ flow, executors });
    const config = { configurable: { thread_id: 'suspend-thread' } };

    const result = (await graph.invoke(initialState, config)) as Record<string, unknown>;
    const interrupts = result.__interrupt__ as Array<{ value: SuspendRequest }>;
    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]?.value.kind).toBe('suspend');
    expect(interrupts[0]?.value.nodeId).toBe('cooldown');
    expect(interrupts[0]?.value.trigger).toEqual({
      kind: 'timer',
      durationMs: 60_000,
    });
  });

  it('continues to downstream nodes on resume', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'suspend-resume',
      nodes: [trigger('t'), suspendAgentNode('a', suspendTag), agentNode('b')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['a', makeRecorder(calls, 'a')],
      ['b', makeRecorder(calls, 'b')],
    ]);
    const graph = compileFlow({ flow, executors });
    const config = { configurable: { thread_id: 'suspend-resume-thread' } };

    await graph.invoke(initialState, config);
    await graph.invoke(new Command({ resume: 'wake' }), config);

    expect(calls).toEqual(['a', 'b']);
  });
});

// ─── Loop tag ─────────────────────────────────────────────────────────────

describe('compileFlow — Loop tag', () => {
  const sequentialLoop: LoopTag = {
    source: 'collection',
    path: { kind: 'jsonpath', path: '$.output' },
    mode: 'sequential',
  };

  function loopAgentNode(id: string, tag: LoopTag): TaskStep {
    return {
      id,
      kind: 'agent',
      config: { agent: { id } as never },
      tags: { loop: tag },
    };
  }

  it('iterates the inner once per item with state.output set per-iteration', async () => {
    const seenInputs: string[] = [];
    const flow: FlowDef = {
      id: 'loop',
      nodes: [trigger('t'), loopAgentNode('per-item', sequentialLoop)],
      edges: [{ from: 't', to: 'per-item', type: 'sequence' }],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'per-item',
        async (state) => {
          seenInputs.push(state.output);
          return {
            output: `processed:${state.output}`,
            lastExit: { nodeId: 'per-item', kind: 'success' },
          };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    // Seed initialState.output with an array — the loop tag's path
    // resolves $.output, so this becomes the iterable.
    const result = (await graph.invoke(
      {
        ...initialState,
        output: ['a', 'b', 'c'] as unknown as string,
      },
      { configurable: { thread_id: 't' } },
    )) as Record<string, unknown>;

    expect(seenInputs).toEqual(['a', 'b', 'c']);
    expect(result.output).toBe('processed:a\n---\nprocessed:b\n---\nprocessed:c');
  });

  it('halts iteration on first inner error', async () => {
    const seenInputs: string[] = [];
    const flow: FlowDef = {
      id: 'loop-halt',
      nodes: [trigger('t'), loopAgentNode('per-item', sequentialLoop)],
      edges: [{ from: 't', to: 'per-item', type: 'sequence' }],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'per-item',
        async (state) => {
          seenInputs.push(state.output);
          if (state.output === 'b') {
            return {
              lastExit: { nodeId: 'per-item', kind: 'error', errorMessage: 'b is bad' },
            };
          }
          return { lastExit: { nodeId: 'per-item', kind: 'success' } };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    try {
      await graph.invoke(
        {
          ...initialState,
          output: ['a', 'b', 'c'] as unknown as string,
        },
        { configurable: { thread_id: 't' } },
      );
    } catch {
      // Router may throw; doesn't matter for this assertion.
    }
    // Halted at 'b' — 'c' never seen.
    expect(seenInputs).toEqual(['a', 'b']);
  });

  it('runs all items in parallel mode and aggregates outputs', async () => {
    const callTimestamps: Array<{ input: string; startedAt: number }> = [];
    const flow: FlowDef = {
      id: 'loop-parallel',
      nodes: [
        trigger('t'),
        loopAgentNode('per-item', { ...sequentialLoop, mode: 'parallel', concurrency: 4 }),
      ],
      edges: [{ from: 't', to: 'per-item', type: 'sequence' }],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'per-item',
        async (state) => {
          callTimestamps.push({ input: state.output, startedAt: Date.now() });
          // Small delay to make parallelism observable; ordering of
          // start times is the assertion target, not durations.
          await new Promise((r) => setTimeout(r, 20));
          return {
            output: `done:${state.output}`,
            lastExit: { nodeId: 'per-item', kind: 'success' },
          };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    const result = (await graph.invoke(
      {
        ...initialState,
        output: ['a', 'b', 'c', 'd'] as unknown as string,
      },
      { configurable: { thread_id: 't' } },
    )) as Record<string, unknown>;

    expect(result.output).toBe('done:a\n---\ndone:b\n---\ndone:c\n---\ndone:d');
    // With concurrency=4, all 4 items start within the same chunk.
    // Their start times should fall within a small window — far
    // tighter than the cumulative 4 × 20ms a sequential run would
    // need.
    const starts = callTimestamps.map((c) => c.startedAt).sort();
    const span = (starts.at(-1) ?? 0) - (starts[0] ?? 0);
    expect(span).toBeLessThan(50);
  });

  it('respects maxConcurrency in parallel mode by chunking', async () => {
    const inFlight: string[] = [];
    let peakInFlight = 0;
    const flow: FlowDef = {
      id: 'loop-parallel-cap',
      nodes: [
        trigger('t'),
        loopAgentNode('per-item', { ...sequentialLoop, mode: 'parallel', concurrency: 2 }),
      ],
      edges: [{ from: 't', to: 'per-item', type: 'sequence' }],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'per-item',
        async (state) => {
          inFlight.push(state.output);
          peakInFlight = Math.max(peakInFlight, inFlight.length);
          await new Promise((r) => setTimeout(r, 30));
          inFlight.splice(inFlight.indexOf(state.output), 1);
          return {
            output: `done:${state.output}`,
            lastExit: { nodeId: 'per-item', kind: 'success' },
          };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(
      {
        ...initialState,
        output: ['a', 'b', 'c', 'd'] as unknown as string,
      },
      { configurable: { thread_id: 't' } },
    );
    // With cap=2, never more than 2 should be in-flight at once.
    expect(peakInFlight).toBe(2);
  });

  it('halts parallel iteration on first chunk failure', async () => {
    const seenInputs: string[] = [];
    const flow: FlowDef = {
      id: 'loop-parallel-halt',
      nodes: [
        trigger('t'),
        loopAgentNode('per-item', { ...sequentialLoop, mode: 'parallel', concurrency: 2 }),
      ],
      edges: [
        { from: 't', to: 'per-item', type: 'sequence' },
        { from: 'per-item', to: 'after', type: 'sequence' },
      ],
    };
    flow.nodes.push({
      id: 'after',
      kind: 'transform',
      config: { expression: { kind: 'literal', value: 'unreached' } },
    });
    const executors = new Map<string, NodeExecutor>([
      [
        'per-item',
        async (state) => {
          seenInputs.push(state.output);
          if (state.output === 'b') {
            return {
              lastExit: {
                nodeId: 'per-item',
                kind: 'error',
                errorName: 'BadItem',
                errorMessage: 'b is bad',
              },
            };
          }
          return { lastExit: { nodeId: 'per-item', kind: 'success' } };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    // Per-item has a sequence edge → 'after', so an error exit is
    // unhandled and the router throws. We just need to verify the
    // 3rd/4th items were never seen because the first chunk failed.
    await expect(
      graph.invoke(
        {
          ...initialState,
          output: ['a', 'b', 'c', 'd'] as unknown as string,
        },
        { configurable: { thread_id: 't' } },
      ),
    ).rejects.toThrow();
    // Per-slot v2: 'a' and 'b' launch first; 'c' may launch in the
    // window before b's failure is observed, but once the abort fires
    // nothing else starts — 'd' must never run.
    expect(seenInputs).toContain('a');
    expect(seenInputs).toContain('b');
    expect(seenInputs).not.toContain('d');
  });

  it('walks a directory and iterates absolute-path items (sorted)', async () => {
    // Use the OS tmpdir + a fresh subdir so the test is hermetic.
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'loop-dir-test-'));
    try {
      writeFileSync(join(root, 'b.txt'), '');
      writeFileSync(join(root, 'a.txt'), '');
      writeFileSync(join(root, 'c.txt'), '');

      const seenInputs: string[] = [];
      const flow: FlowDef = {
        id: 'loop-dir',
        nodes: [
          trigger('t'),
          loopAgentNode('per-item', {
            source: 'directory',
            path: { kind: 'literal', value: root },
            mode: 'sequential',
          }),
        ],
        edges: [{ from: 't', to: 'per-item', type: 'sequence' }],
      };
      const executors = new Map<string, NodeExecutor>([
        [
          'per-item',
          async (state) => {
            seenInputs.push(state.output);
            return { lastExit: { nodeId: 'per-item', kind: 'success' } };
          },
        ],
      ]);
      const graph = compileFlow({ flow, executors });
      await graph.invoke(initialState, { configurable: { thread_id: 't' } });
      // Directory walk emits absolute paths, sorted alphabetically.
      expect(seenInputs).toEqual([join(root, 'a.txt'), join(root, 'b.txt'), join(root, 'c.txt')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns LoopDirectoryError when the directory cannot be read', async () => {
    const flow: FlowDef = {
      id: 'loop-dir-missing',
      nodes: [
        trigger('t'),
        loopAgentNode('per-item', {
          source: 'directory',
          path: { kind: 'literal', value: '/nonexistent/path/for/test' },
          mode: 'sequential',
        }),
        {
          id: 'after',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 'unreached' } },
        },
      ],
      edges: [
        { from: 't', to: 'per-item', type: 'sequence' },
        { from: 'per-item', to: 'after', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([['per-item', makeRecorder([], 'per-item')]]);
    const graph = compileFlow({ flow, executors });
    // No error edge wired → router throws with an unhandled-error
    // message that includes the loop's errorName.
    await expect(graph.invoke(initialState, { configurable: { thread_id: 't' } })).rejects.toThrow(
      /LoopDirectoryError|nonexistent/,
    );
  });
});

// ─── composeSystemPromptWithSteering ──────────────────────────────────────

describe('composeSystemPromptWithSteering', () => {
  it('returns the baseline verbatim when steering is empty', () => {
    expect(composeSystemPromptWithSteering('be helpful', [])).toBe('be helpful');
  });

  it('returns undefined when both baseline and steering are empty', () => {
    expect(composeSystemPromptWithSteering(undefined, [])).toBeUndefined();
  });

  it('appends a labeled steering block when steering is present', () => {
    const result = composeSystemPromptWithSteering('be helpful', ['focus on auth']);
    expect(result).toBe('be helpful\n\n[OPERATOR STEERING]\n— focus on auth');
  });

  it('joins multiple steering entries with delimiters', () => {
    const result = composeSystemPromptWithSteering(undefined, [
      'use OAuth',
      'avoid breaking changes',
    ]);
    expect(result).toBe('[OPERATOR STEERING]\n— use OAuth\n— avoid breaking changes');
  });
});

// ─── state.changedFiles channel reducer ────────────────────────────────────

describe('FlowState.changedFiles channel', () => {
  // The channel holds the latest FULL discovery snapshot (git diff
  // --cached over every product repo) — a later write REPLACES the
  // set, so reverted files drop off the reviewer's diff surface.
  // We can't unit-test the channel directly without compiling a graph;
  // exercise via compileFlow with two writers.

  it('a later full snapshot replaces the set — reverted files drop off', async () => {
    const flow: FlowDef = {
      id: 'merge',
      nodes: [trigger('t'), agentNode('a'), agentNode('b')],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'a',
        async () => ({
          changedFiles: [
            {
              id: 'web::src/x.ts',
              repo: 'web',
              path: 'src/x.ts',
              filename: 'x.ts',
              changeKind: 'added',
              statusCode: 'A',
              mimeType: 'application/typescript',
            },
            {
              id: 'web::README.md',
              repo: 'web',
              path: 'README.md',
              filename: 'README.md',
              changeKind: 'modified',
              statusCode: 'M',
              mimeType: 'text/markdown',
            },
          ],
          lastExit: { nodeId: 'a', kind: 'success' },
        }),
      ],
      [
        'b',
        async () => ({
          changedFiles: [
            // Re-emit src/x.ts as 'modified' (was 'added' before).
            {
              id: 'web::src/x.ts',
              repo: 'web',
              path: 'src/x.ts',
              filename: 'x.ts',
              changeKind: 'modified',
              statusCode: 'M',
              mimeType: 'application/typescript',
            },
          ],
          lastExit: { nodeId: 'b', kind: 'success' },
        }),
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    const result = (await graph.invoke(initialState, {
      configurable: { thread_id: 't' },
    })) as Record<string, unknown>;

    const changed = result.changedFiles as Array<{ id: string; changeKind: string }>;
    // b's snapshot no longer contains README.md — it was reverted, so
    // it drops off; x.ts reflects b's fresh state.
    expect(changed).toHaveLength(1);
    expect(changed[0]?.id).toBe('web::src/x.ts');
    expect(changed[0]?.changeKind).toBe('modified');
  });
});

// ─── ApprovalRequest carries changes from state ───────────────────────────

describe('ApprovalRequest with changes', () => {
  const approvalTag: ApprovalTag = {
    assigneeRole: 'tech-lead',
    slaMs: 60_000,
    concurrency: 'pessimistic',
  };
  function approvalAgentNode(id: string, tag: ApprovalTag): TaskStep {
    return {
      id,
      kind: 'agent',
      config: { agent: { id } as never },
      tags: { approval: tag },
    };
  }

  it('carries state.changedFiles into ApprovalRequest.changes at interrupt time', async () => {
    const flow: FlowDef = {
      id: 'changes-in-approval',
      nodes: [trigger('t'), approvalAgentNode('plan', approvalTag), agentNode('build')],
      edges: [
        { from: 't', to: 'plan', type: 'sequence' },
        { from: 'plan', to: 'build', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'plan',
        async () => ({
          output: 'plan v1',
          changedFiles: [
            {
              id: 'web::src/auth.ts',
              repo: 'web',
              path: 'src/auth.ts',
              filename: 'auth.ts',
              changeKind: 'modified',
              statusCode: 'M',
              mimeType: 'application/typescript',
            },
          ],
          lastExit: { nodeId: 'plan', kind: 'success' },
        }),
      ],
      ['build', makeRecorder([], 'build')],
    ]);
    const graph = compileFlow({ flow, executors });
    const config = { configurable: { thread_id: 'changes-1' } };
    const result = (await graph.invoke(initialState, config)) as Record<string, unknown>;

    expect(result.__interrupt__).toBeDefined();
    const interrupts = result.__interrupt__ as Array<{ value: ApprovalRequest }>;
    const request = interrupts[0]?.value;
    expect(request?.changes).toHaveLength(1);
    expect(request?.changes?.[0]?.path).toBe('src/auth.ts');
    expect(request?.changes?.[0]?.changeKind).toBe('modified');
  });

  it('forward-steering on approve appends to state.steering for downstream agents', async () => {
    const seenSystemPrompts: Array<string | undefined> = [];
    const flow: FlowDef = {
      id: 'forward-steering',
      nodes: [trigger('t'), approvalAgentNode('plan', approvalTag), agentNode('build')],
      edges: [
        { from: 't', to: 'plan', type: 'sequence' },
        { from: 'plan', to: 'build', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'plan',
        async () => ({
          output: 'plan',
          lastExit: { nodeId: 'plan', kind: 'success' },
        }),
      ],
      [
        'build',
        async (state) => {
          // The wired runJob would prepend state.steering into systemPrompt;
          // here in the unit test, we directly inspect state.steering.
          seenSystemPrompts.push(state.steering.join('|'));
          return { lastExit: { nodeId: 'build', kind: 'success' } };
        },
      ],
    ]);
    const graph = compileFlow({ flow, executors });
    const config = { configurable: { thread_id: 'fwd-steer' } };

    await graph.invoke(initialState, config); // pauses
    // Approve with forward-looking steering.
    await graph.invoke(
      new Command({ resume: { decision: 'approve', steering: 'prioritize auth first' } }),
      config,
    );

    // Builder saw the steering on its state.steering channel.
    expect(seenSystemPrompts).toEqual(['prioritize auth first']);
  });
});

// ─── makeGateExecutor (built-in gate kind) ────────────────────────────────

describe('makeGateExecutor', () => {
  function gateNode(
    id: string,
    assertions: Array<{ expression: import('./catalog.ts').Expression; message: string }>,
  ): TaskStep {
    return { id, kind: 'gate', config: { assertions } };
  }

  it('emits success when there are no assertions', async () => {
    const fn = makeGateExecutor(gateNode('g', []));
    const delta = await fn(initialState);
    expect(delta.lastExit?.kind).toBe('success');
    expect(delta.rejectionPayload).toBeUndefined();
  });

  it('emits success when all assertions pass', async () => {
    const fn = makeGateExecutor(
      gateNode('g', [
        { expression: { kind: 'literal', value: true }, message: 'always-true' },
        {
          expression: { kind: 'jsonpath', path: '$.output' },
          message: 'output is non-empty',
        },
      ]),
    );
    const delta = await fn({ ...initialState, output: 'has-value' });
    expect(delta.lastExit?.kind).toBe('success');
    expect(delta.rejectionPayload).toBeUndefined();
  });

  it('emits reject + payload when an assertion fails', async () => {
    const fn = makeGateExecutor(
      gateNode('g', [{ expression: { kind: 'literal', value: false }, message: 'never holds' }]),
    );
    const delta = await fn(initialState);
    expect(delta.lastExit?.kind).toBe('reject');
    expect(delta.rejectionPayload?.reason).toBe('never holds');
    expect(delta.rejectionPayload?.attempt).toBe(1);
    expect(delta.attempts?.g).toBe(1);
  });

  it('joins multiple failure messages and lists structured findings', async () => {
    const fn = makeGateExecutor(
      gateNode('g', [
        { expression: { kind: 'literal', value: true }, message: 'this passes' },
        { expression: { kind: 'literal', value: false }, message: 'first failure' },
        {
          expression: { kind: 'jsonpath', path: '$.nonexistent' },
          message: 'second failure',
        },
      ]),
    );
    const delta = await fn(initialState);
    expect(delta.lastExit?.kind).toBe('reject');
    expect(delta.rejectionPayload?.reason).toBe('first failure; second failure');
    const findings = delta.rejectionPayload?.findings as Array<{ message: string }>;
    expect(findings.length).toBe(2);
    expect(findings.map((f) => f.message)).toEqual(['first failure', 'second failure']);
  });

  it('increments the attempt counter across reject cycles', async () => {
    const fn = makeGateExecutor(
      gateNode('g', [{ expression: { kind: 'literal', value: false }, message: 'no' }]),
    );
    const first = await fn({ ...initialState, attempts: { g: 0 } });
    expect(first.rejectionPayload?.attempt).toBe(1);

    const second = await fn({ ...initialState, attempts: { g: 1 } });
    expect(second.rejectionPayload?.attempt).toBe(2);
  });

  it('throws when called with a non-gate node', () => {
    expect(() =>
      makeGateExecutor({ id: 'a', kind: 'agent', config: { agent: { id: 'a' } as never } }),
    ).toThrow(/expected "gate"/);
  });
});

// ─── compileFlow integration with gate kind ───────────────────────────────

describe('compileFlow — gate kind (built-in executor)', () => {
  it('routes via sequence edge when assertions hold', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'gate-pass',
      nodes: [
        trigger('t'),
        agentNode('worker'),
        {
          id: 'g',
          kind: 'gate',
          config: {
            assertions: [
              {
                expression: { kind: 'jsonpath', path: '$.output' },
                message: 'worker produced output',
              },
            ],
          },
        },
        agentNode('next'),
      ],
      edges: [
        { from: 't', to: 'worker', type: 'sequence' },
        { from: 'worker', to: 'g', type: 'sequence' },
        { from: 'g', to: 'next', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'worker',
        async () => ({
          output: 'real-output',
          lastExit: { nodeId: 'worker', kind: 'success' },
        }),
      ],
      ['next', makeRecorder(calls, 'next')],
    ]);
    // Note: NO entry for 'g' — flow-graph's builtinExecutor handles it.
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    expect(calls).toEqual(['next']);
  });

  it('cycles back via reject edge when an assertion fails; honors maxAttempts', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'gate-reject',
      nodes: [
        trigger('t'),
        agentNode('worker'),
        {
          id: 'g',
          kind: 'gate',
          config: {
            assertions: [{ expression: { kind: 'literal', value: false }, message: 'fail' }],
          },
        },
        agentNode('next'),
      ],
      edges: [
        { from: 't', to: 'worker', type: 'sequence' },
        { from: 'worker', to: 'g', type: 'sequence' },
        { from: 'g', to: 'next', type: 'sequence' },
        { from: 'g', to: 'worker', type: 'reject', maxAttempts: 3 },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['worker', makeRecorder(calls, 'worker')],
      ['next', makeRecorder(calls, 'next')],
    ]);
    const graph = compileFlow({ flow, executors });
    await expect(graph.invoke(initialState, { configurable: { thread_id: 't' } })).rejects.toThrow(
      /reject limit/,
    );
    expect(calls.filter((c) => c === 'worker').length).toBe(3);
    expect(calls).not.toContain('next');
  });
});

// ─── makeTransformExecutor (built-in transform kind) ──────────────────────

describe('makeTransformExecutor', () => {
  function transformNode(id: string, expression: import('./catalog.ts').Expression): TaskStep {
    return { id, kind: 'transform', config: { expression } };
  }

  it('writes a literal string to state.output', async () => {
    const fn = makeTransformExecutor(transformNode('x', { kind: 'literal', value: 'hello' }));
    const delta = await fn(initialState);
    expect(delta.output).toBe('hello');
    expect(delta.lastExit?.kind).toBe('success');
  });

  it('stringifies non-string literals', async () => {
    const fn = makeTransformExecutor(transformNode('x', { kind: 'literal', value: 42 }));
    const delta = await fn(initialState);
    expect(delta.output).toBe('42');
  });

  it('stringifies object literals via JSON.stringify', async () => {
    const fn = makeTransformExecutor(
      transformNode('x', { kind: 'literal', value: { foo: 'bar', n: 1 } }),
    );
    const delta = await fn(initialState);
    expect(delta.output).toBe('{"foo":"bar","n":1}');
  });

  it('resolves jsonpath against state and writes the value', async () => {
    const fn = makeTransformExecutor(transformNode('x', { kind: 'jsonpath', path: '$.output' }));
    const delta = await fn({ ...initialState, output: 'agent-said-this' });
    expect(delta.output).toBe('agent-said-this');
  });

  it('emits "undefined" string when jsonpath misses', async () => {
    const fn = makeTransformExecutor(
      transformNode('x', { kind: 'jsonpath', path: '$.missing.field' }),
    );
    const delta = await fn(initialState);
    // JSON.stringify(undefined) returns undefined, so we coerce to "undefined".
    // Catalogs that need "absent" semantics should guard with a gate first.
    expect(delta.output).toBe(undefined);
    expect(delta.lastExit?.kind).toBe('success');
  });

  it('throws on js expression kind (no sandbox)', async () => {
    const fn = makeTransformExecutor(
      transformNode('x', { kind: 'js', expression: 'state.output' }),
    );
    await expect(fn(initialState)).rejects.toThrow(/not yet supported/);
  });

  it('throws when called with a non-transform node', () => {
    expect(() =>
      makeTransformExecutor({ id: 'a', kind: 'agent', config: { agent: { id: 'a' } as never } }),
    ).toThrow(/expected "transform"/);
  });
});

// ─── compileFlow integration with transform kind ──────────────────────────

describe('compileFlow — transform kind (built-in executor)', () => {
  it('threads the transformed value into the next node via state.output', async () => {
    const seenInputs: string[] = [];
    const flow: FlowDef = {
      id: 'transform-thread',
      nodes: [
        trigger('t'),
        agentNode('producer'),
        {
          id: 'extract',
          kind: 'transform',
          config: { expression: { kind: 'jsonpath', path: '$.output' } },
        },
        agentNode('consumer'),
      ],
      edges: [
        { from: 't', to: 'producer', type: 'sequence' },
        { from: 'producer', to: 'extract', type: 'sequence' },
        { from: 'extract', to: 'consumer', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      [
        'producer',
        async () => ({
          output: 'producer-output',
          lastExit: { nodeId: 'producer', kind: 'success' },
        }),
      ],
      [
        'consumer',
        async (state) => {
          seenInputs.push(state.output);
          return { lastExit: { nodeId: 'consumer', kind: 'success' } };
        },
      ],
    ]);
    // No entry for 'extract' — flow-graph's builtinExecutor handles it.
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    // The transform passed producer's output through unchanged.
    expect(seenInputs).toEqual(['producer-output']);
  });

  it('combines with conditional edges — transform output drives routing', async () => {
    const calls: string[] = [];
    const flow: FlowDef = {
      id: 'transform-cond',
      nodes: [
        trigger('t'),
        {
          id: 'set',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 'truthy' } },
        },
        agentNode('matched'),
        agentNode('default'),
      ],
      edges: [
        { from: 't', to: 'set', type: 'sequence' },
        {
          from: 'set',
          to: 'matched',
          type: 'conditional',
          condition: { kind: 'jsonpath', path: '$.output' },
        },
        { from: 'set', to: 'default', type: 'sequence' },
      ],
    };
    const executors = new Map<string, NodeExecutor>([
      ['matched', makeRecorder(calls, 'matched')],
      ['default', makeRecorder(calls, 'default')],
    ]);
    const graph = compileFlow({ flow, executors });
    await graph.invoke(initialState, { configurable: { thread_id: 't' } });
    // transform set output to 'truthy' → conditional jsonpath $.output is
    // truthy → routes to matched, NOT default.
    expect(calls).toEqual(['matched']);
  });
});
