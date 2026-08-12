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

  it('accepts the new expression kinds (exists, object, array) and string compare ops', () => {
    const flow = {
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        {
          id: 'g',
          kind: 'gate',
          config: {
            assertions: [
              {
                expression: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.nodes.a' } },
                message: 'a ran',
              },
              {
                expression: {
                  kind: 'compare',
                  lhs: { kind: 'jsonpath', path: '$.output' },
                  op: 'contains',
                  rhs: { kind: 'literal', value: 'APPROVED' },
                },
                message: 'approved',
              },
              {
                expression: {
                  kind: 'object',
                  fields: { xs: { kind: 'array', items: [{ kind: 'literal', value: 1 }] } },
                },
                message: 'constructor',
              },
            ],
          },
        },
      ],
    };
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).not.toThrow();
  });

  it('rejects an invalid literal regex for matches at load time', () => {
    const flow = {
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        {
          id: 'g',
          kind: 'gate',
          config: {
            assertions: [
              {
                expression: {
                  kind: 'compare',
                  lhs: { kind: 'jsonpath', path: '$.output' },
                  op: 'matches',
                  rhs: { kind: 'literal', value: '(' },
                },
                message: 'x',
              },
            ],
          },
        },
      ],
    };
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).toThrow(
      /not a valid regular expression/,
    );
  });

  it('rejects malformed object/array constructors', () => {
    const withExpr = (expression: unknown) => ({
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        { id: 'g', kind: 'transform', config: { expression } },
      ],
    });
    expect(() =>
      validateFlowCatalog({ flows: [withExpr({ kind: 'object', fields: [] })] }, 'test'),
    ).toThrow(/fields must be an object/);
    expect(() =>
      validateFlowCatalog({ flows: [withExpr({ kind: 'array', items: {} })] }, 'test'),
    ).toThrow(/items must be an array/);
  });

  it('accepts a node input mapping and rejects a non-expression entry', () => {
    const withInput = (input: unknown) => ({
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        {
          id: 'g',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 1 } },
          input,
        },
      ],
    });
    expect(() =>
      validateFlowCatalog(
        { flows: [withInput({ context: { kind: 'jsonpath', path: '$.nodes.plan' } })] },
        'test',
      ),
    ).not.toThrow();
    // Single-Expression form
    expect(() =>
      validateFlowCatalog({ flows: [withInput({ kind: 'jsonpath', path: '$.input' })] }, 'test'),
    ).not.toThrow();
    expect(() => validateFlowCatalog({ flows: [withInput({ context: 5 })] }, 'test')).toThrow(
      /input\.context/,
    );
    expect(() => validateFlowCatalog({ flows: [withInput({})] }, 'test')).toThrow(
      /at least one entry/,
    );
  });

  it('accepts output contracts and rejects schema on kind text', () => {
    const withOutput = (output: unknown) => ({
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        {
          id: 'g',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 1 } },
          output,
        },
      ],
    });
    expect(() =>
      validateFlowCatalog({ flows: [withOutput({ kind: 'json' })] }, 'test'),
    ).not.toThrow();
    expect(() =>
      validateFlowCatalog({ flows: [withOutput({ kind: 'text', schema: {} })] }, 'test'),
    ).toThrow(/schema is only allowed/);
    expect(() => validateFlowCatalog({ flows: [withOutput({ kind: 'yaml' })] }, 'test')).toThrow(
      /must be 'text' or 'json'/,
    );
  });

  it('rejects unknown effect values and accepts the known three', () => {
    const withEffect = (effect: unknown) => ({
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        {
          id: 'g',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 1 } },
          effect,
        },
      ],
    });
    for (const ok of ['pure', 'idempotent', 'side-effecting']) {
      expect(() => validateFlowCatalog({ flows: [withEffect(ok)] }, 'test')).not.toThrow();
    }
    expect(() => validateFlowCatalog({ flows: [withEffect('sometimes')] }, 'test')).toThrow(
      /effect must be/,
    );
  });

  it('accepts flow version and rejects an empty one', () => {
    expect(() =>
      validateFlowCatalog({ flows: [{ ...validFlow, version: '1.2.0' }] }, 'test'),
    ).not.toThrow();
    expect(() => validateFlowCatalog({ flows: [{ ...validFlow, version: '' }] }, 'test')).toThrow(
      /version must be a non-empty string/,
    );
  });

  it('validates script secrets shape', () => {
    const withSecrets = (secrets: unknown) => ({
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        {
          id: 'g',
          kind: 'script',
          config: { language: 'bash', source: 'true', secrets },
        },
      ],
    });
    expect(() =>
      validateFlowCatalog(
        { flows: [withSecrets({ API_KEY: { credentialId: 'anthropic' } })] },
        'test',
      ),
    ).not.toThrow();
    expect(() => validateFlowCatalog({ flows: [withSecrets({ API_KEY: {} })] }, 'test')).toThrow(
      /credentialId/,
    );
    expect(() => validateFlowCatalog({ flows: [withSecrets(['x'])] }, 'test')).toThrow(
      /secrets must be an object/,
    );
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
  it('reports node-output-schema, effect, and subflow-version-pin', () => {
    const reported: UnsupportedFeature[] = [];
    const catalog = {
      flows: [
        {
          id: 'demo',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'manual' } },
            {
              id: 'a',
              kind: 'transform',
              config: { expression: { kind: 'literal', value: 1 } },
              output: { kind: 'json', schema: { type: 'object' } },
              effect: 'pure',
            },
            {
              id: 's',
              kind: 'subflow',
              config: { flowId: 'inner', version: '2.0.0' },
            },
          ],
          edges: [
            { from: 't', to: 'a', type: 'sequence' },
            { from: 'a', to: 's', type: 'sequence' },
          ],
        },
      ],
    };
    validateFlowCatalog(catalog, 'test', { onUnsupported: (f) => reported.push(f) });
    const features = reported.map((f) => f.feature);
    expect(features).toContain('node-output-schema');
    expect(features).toContain('effect');
    expect(features).toContain('subflow-version-pin');
    // json output WITHOUT a schema is fully executed — no report.
    const reported2: UnsupportedFeature[] = [];
    const catalog2 = {
      flows: [
        {
          id: 'demo2',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'manual' } },
            {
              id: 'a',
              kind: 'transform',
              config: { expression: { kind: 'literal', value: 1 } },
              output: { kind: 'json' },
            },
          ],
          edges: [{ from: 't', to: 'a', type: 'sequence' }],
        },
      ],
    };
    validateFlowCatalog(catalog2, 'test', { onUnsupported: (f) => reported2.push(f) });
    expect(reported2).toEqual([]);
  });

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
