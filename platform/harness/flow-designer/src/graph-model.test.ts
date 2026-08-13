import type { FlowDef } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { flowToGraph, graphToFlow } from './graph-model.ts';

const diamond: FlowDef = {
  id: 'diamond',
  kind: 'work',
  nodes: [
    { id: 't', kind: 'trigger', config: { kind: 'manual' } },
    { id: 'plan', kind: 'agent', config: { agent: { id: 'plan' } as never } },
    { id: 'a', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
    { id: 'b', kind: 'transform', config: { expression: { kind: 'literal', value: 2 } } },
    {
      id: 'join',
      kind: 'gate',
      joinStrategy: 'all',
      config: { assertions: [{ expression: { kind: 'literal', value: true }, message: 'ok' }] },
    },
  ],
  edges: [
    { from: 't', to: 'plan', type: 'sequence' },
    { from: 'plan', to: 'a', type: 'sequence' },
    { from: 'plan', to: 'b', type: 'sequence' },
    { from: 'a', to: 'join', type: 'sequence' },
    { from: 'b', to: 'join', type: 'sequence' },
    { from: 'join', to: 'plan', type: 'reject', maxAttempts: 2 },
  ],
};

describe('flowToGraph / graphToFlow', () => {
  it('round-trips a flow without loss', () => {
    const { nodes, edges } = flowToGraph(diamond);
    expect(graphToFlow(diamond, nodes, edges)).toEqual(diamond);
  });

  it('lays every node out at a distinct finite position', () => {
    const { nodes } = flowToGraph(diamond);
    const seen = new Set(nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(seen.size).toBe(diamond.nodes.length);
    for (const n of nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('gives parallel edges between the same pair distinct ids', () => {
    const flow: FlowDef = {
      ...diamond,
      edges: [
        { from: 't', to: 'plan', type: 'sequence' },
        {
          from: 't',
          to: 'plan',
          type: 'conditional',
          condition: { kind: 'literal', value: true },
        },
      ],
    };
    const { edges } = flowToGraph(flow);
    expect(new Set(edges.map((e) => e.id)).size).toBe(2);
  });

  it('graphToFlow rewrites edge endpoints from the canvas connection', () => {
    const { nodes, edges } = flowToGraph(diamond);
    const rewired = edges.map((e) => (e.data.edge.type === 'reject' ? { ...e, target: 'a' } : e));
    const out = graphToFlow(diamond, nodes, rewired);
    expect(out.edges.find((e) => e.type === 'reject')?.to).toBe('a');
  });
});
