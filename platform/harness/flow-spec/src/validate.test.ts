import { describe, expect, it } from 'vitest';
import { CatalogError, validateFlowCatalog } from './index.ts';

const validFlow = {
  id: 'demo',
  nodes: [
    { id: 't', kind: 'trigger', config: { kind: 'manual' } },
    {
      id: 'g',
      kind: 'gate',
      config: { assertions: [{ expression: { kind: 'literal', value: true }, message: 'ok' }] },
    },
  ],
  edges: [{ from: 't', to: 'g', type: 'sequence' }],
};

describe('validateFlowCatalog', () => {
  it('accepts a minimal valid catalog', () => {
    expect(() => validateFlowCatalog({ flows: [validFlow] }, 'test')).not.toThrow();
  });

  it('rejects an edge to an unknown node with a located error', () => {
    const bad = { flows: [{ ...validFlow, edges: [{ from: 't', to: 'ghost', type: 'sequence' }] }] };
    expect(() => validateFlowCatalog(bad, 'test')).toThrow(CatalogError);
    expect(() => validateFlowCatalog(bad, 'test')).toThrow(/unknown node "ghost"/);
  });

  it('rejects cycles on non-reject edges', () => {
    const cyclic = {
      flows: [
        {
          ...validFlow,
          edges: [
            { from: 't', to: 'g', type: 'sequence' },
            { from: 'g', to: 'g', type: 'sequence' },
          ],
        },
      ],
    };
    expect(() => validateFlowCatalog(cyclic, 'test')).toThrow(/cycle detected/);
  });
});
