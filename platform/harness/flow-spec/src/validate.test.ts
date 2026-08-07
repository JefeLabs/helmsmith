import { describe, expect, it } from 'vitest';
import { CatalogError, type UnsupportedFeature, validateFlowCatalog } from './index.ts';

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
    const bad = {
      flows: [{ ...validFlow, edges: [{ from: 't', to: 'ghost', type: 'sequence' }] }],
    };
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

describe('unsupported-feature reporting', () => {
  it('reports policy, joinStrategy, terminal, non-manual triggers, js expressions, and extra sequence edges', () => {
    const reported: UnsupportedFeature[] = [];
    const catalog = {
      flows: [
        {
          id: 'demo',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'schedule', cron: '0 * * * *' } },
            {
              id: 'a',
              kind: 'transform',
              config: { expression: { kind: 'literal', value: 1 } },
              policy: { retry: { maxAttempts: 3 } },
              joinStrategy: 'any',
            },
            {
              id: 'b',
              kind: 'transform',
              config: { expression: { kind: 'literal', value: 1 } },
              terminal: 'fail',
            },
            {
              id: 'c',
              kind: 'gate',
              config: {
                assertions: [{ expression: { kind: 'js', expression: 'true' }, message: 'x' }],
              },
            },
          ],
          edges: [
            { from: 't', to: 'a', type: 'sequence' },
            { from: 'a', to: 'b', type: 'sequence' },
            { from: 'a', to: 'c', type: 'sequence' },
          ],
        },
      ],
    };
    validateFlowCatalog(catalog, 'test', { onUnsupported: (f) => reported.push(f) });
    const features = reported.map((f) => f.feature).sort();
    expect(features).toEqual([
      'expression-js',
      'joinStrategy',
      'parallel-fan-out',
      'policy',
      'terminal-fail',
      'trigger-schedule',
    ]);
    for (const f of reported) {
      expect(f.where).toContain('test');
      expect(f.detail.length).toBeGreaterThan(0);
    }
  });

  it('reports nothing for a fully-supported flow and stays silent without a callback', () => {
    const reported: UnsupportedFeature[] = [];
    const ok = { flows: [validFlow] };
    validateFlowCatalog(ok, 'test', { onUnsupported: (f) => reported.push(f) });
    expect(reported).toEqual([]);
    expect(() => validateFlowCatalog(ok, 'test')).not.toThrow();
  });
});
