import { describe, expect, it } from 'vitest';
import { CatalogError, type UnsupportedFeature, validateFlowCatalog, walkAgents } from './index.ts';

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
  // ── AgentDef.bootstrap ───────────────────────────────────────────────
  // Environment prep for CLI-backed agents: argv, no shell, CLI adapters only.
  const flowWithAgent = (agent: Record<string, unknown>) => ({
    ...validFlow,
    nodes: [validFlow.nodes[0], { id: 'a', kind: 'agent', config: { agent } }],
    edges: [{ from: 't', to: 'a', type: 'sequence' }],
  });
  const cliAgent = (bootstrap: unknown) => ({
    id: 'a',
    role: 'Agent',
    adapter: 'copilot-cli',
    bootstrap,
  });

  it('accepts bootstrap on a CLI-backed adapter', () => {
    const flow = flowWithAgent(
      cliAgent([
        { run: ['copilot', 'plugin', 'marketplace', 'add', 'obra/superpowers-marketplace'] },
        {
          run: ['copilot', 'plugin', 'install', 'superpowers@superpowers-marketplace'],
          description: 'install the plugin the system prompt assumes',
        },
      ]),
    );
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).not.toThrow();
  });

  it('rejects bootstrap on an adapter that is not CLI-backed', () => {
    const flow = flowWithAgent({
      id: 'a',
      role: 'Agent',
      adapter: 'claude-sdk',
      bootstrap: [{ run: ['copilot', 'plugin', 'install', 'x'] }],
    });
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).toThrow(CatalogError);
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).toThrow(
      /only supported on CLI-backed adapters/,
    );
  });

  it('rejects an empty bootstrap list as dead config', () => {
    const flow = flowWithAgent(cliAgent([]));
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).toThrow(
      /bootstrap must not be empty when present/,
    );
  });

  it('rejects a step whose run is missing, empty, or not an array', () => {
    for (const bad of [[{}], [{ run: [] }], [{ run: 'copilot plugin install x' }]]) {
      const flow = flowWithAgent(cliAgent(bad));
      expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).toThrow(
        /run must be a non-empty array of strings/,
      );
    }
  });

  it('rejects an empty argv entry, locating which one', () => {
    const flow = flowWithAgent(cliAgent([{ run: ['copilot', ''] }]));
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).toThrow(
      /bootstrap\[0\]\.run\[1\] must be a non-empty string/,
    );
  });

  // With no shell these are inert literal arguments. Filtering them would
  // break legitimate args while adding no safety — this pins that decision.
  it('accepts argv entries containing shell metacharacters', () => {
    const flow = flowWithAgent(cliAgent([{ run: ['mytool', '--glob', 'src/**/*.ts;'] }]));
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).not.toThrow();
  });

  it('honours cliAdapters in both directions', () => {
    const nonConforming = flowWithAgent({
      id: 'a',
      role: 'Agent',
      adapter: 'copilot',
      bootstrap: [{ run: ['copilot', 'plugin', 'install', 'x'] }],
    });
    expect(() => validateFlowCatalog({ flows: [nonConforming] }, 'test')).toThrow(
      /only supported on CLI-backed adapters/,
    );
    expect(() =>
      validateFlowCatalog({ flows: [nonConforming] }, 'test', { cliAdapters: ['copilot'] }),
    ).not.toThrow();

    // The override REPLACES the suffix rule, so a -cli adapter absent from
    // the list is then rejected.
    const suffixed = flowWithAgent(cliAgent([{ run: ['copilot', 'plugin', 'install', 'x'] }]));
    expect(() =>
      validateFlowCatalog({ flows: [suffixed] }, 'test', { cliAdapters: ['something-else'] }),
    ).toThrow(/only supported on CLI-backed adapters/);
  });
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
      nodes: [validFlow.nodes[0], { id: 'g', kind: 'transform', config: { expression } }],
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

  it('allows multiple error edges when at most one is a catch-all', () => {
    const nodes = [
      validFlow.nodes[0],
      { id: 'g', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
      { id: 'h1', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
      { id: 'h2', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
    ];
    const ok = {
      ...validFlow,
      nodes,
      edges: [
        { from: 't', to: 'g', type: 'sequence' },
        { from: 'g', to: 'h1', type: 'error', on: ['Timeout'] },
        { from: 'g', to: 'h2', type: 'error' },
      ],
    };
    expect(() => validateFlowCatalog({ flows: [ok] }, 'test')).not.toThrow();
    const twoCatchAlls = {
      ...validFlow,
      nodes,
      edges: [
        { from: 't', to: 'g', type: 'sequence' },
        { from: 'g', to: 'h1', type: 'error' },
        { from: 'g', to: 'h2', type: 'error' },
      ],
    };
    expect(() => validateFlowCatalog({ flows: [twoCatchAlls] }, 'test')).toThrow(
      /at most one catch-all 'error' edge/,
    );
    const badOn = {
      ...validFlow,
      nodes,
      edges: [
        { from: 't', to: 'g', type: 'sequence' },
        { from: 'g', to: 'h1', type: 'error', on: [''] },
      ],
    };
    expect(() => validateFlowCatalog({ flows: [badOn] }, 'test')).toThrow(
      /on\[0\] must be a non-empty string/,
    );
  });

  it('rejects an error name shadowed within the same on list', () => {
    const flow = {
      ...validFlow,
      nodes: [
        validFlow.nodes[0],
        { id: 'g', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
        { id: 'h1', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
      ],
      edges: [
        { from: 't', to: 'g', type: 'sequence' },
        { from: 'g', to: 'h1', type: 'error', on: ['Timeout', 'Timeout'] },
      ],
    };
    expect(() => validateFlowCatalog({ flows: [flow] }, 'test')).toThrow(/can never fire/);
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
  it('structured flow output with a subset schema is executed and silent', () => {
    const reported: UnsupportedFeature[] = [];
    validateFlowCatalog(
      { flows: [{ ...validFlow, output: { kind: 'structured', schema: { type: 'object' } } }] },
      'test',
      { onUnsupported: (f) => reported.push(f) },
    );
    expect(reported).toEqual([]);
  });

  it('reports subflow-version-pin; effect and output schemas are executed and silent', () => {
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
    // node output schemas are load-time subset-gated + runtime-enforced.
    expect(features).not.toContain('node-output-schema');
    // effect is consulted by the runtime (replay guard) — no report.
    expect(features).not.toContain('effect');
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

  it('reports js expressions — policy/joinStrategy/fan-out/terminal/ingress-triggers are executed and silent', () => {
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
    expect(features).toEqual(['expression-js']);
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

describe('walkAgents', () => {
  const agentNode = (id: string) => ({
    id,
    kind: 'agent' as const,
    config: { agent: { id, role: 'r', adapter: 'claude-sdk' } as never },
  });
  const triggerNode = { id: 't', kind: 'trigger' as const, config: { kind: 'manual' } as never };
  const subflowNode = (id: string, flowId: string) => ({
    id,
    kind: 'subflow' as const,
    config: { flowId } as never,
  });

  it('yields agents from the flow itself without a resolver (v1 behavior unchanged)', () => {
    const flow = { id: 'f', nodes: [triggerNode, agentNode('a1')], edges: [] };
    expect([...walkAgents(flow as never)].map((a) => a.id)).toEqual(['a1']);
  });

  it('recurses through subflow targets when a resolver is provided', () => {
    const inner = { id: 'inner', nodes: [triggerNode, agentNode('deep')], edges: [] };
    const outer = {
      id: 'outer',
      nodes: [triggerNode, agentNode('top'), subflowNode('s', 'inner')],
      edges: [],
    };
    const resolver = (id: string) => (id === 'inner' ? (inner as never) : undefined);
    expect([...walkAgents(outer as never, resolver)].map((a) => a.id)).toEqual(['top', 'deep']);
  });

  it('visits each flow once — shared targets and cycles do not duplicate or hang', () => {
    const inner = {
      id: 'inner',
      nodes: [triggerNode, agentNode('deep'), subflowNode('back', 'outer')],
      edges: [],
    };
    const outer = {
      id: 'outer',
      nodes: [triggerNode, subflowNode('s1', 'inner'), subflowNode('s2', 'inner')],
      edges: [],
    };
    const flows: Record<string, unknown> = { inner, outer };
    const agents = [...walkAgents(outer as never, (id) => flows[id] as never)];
    expect(agents.map((a) => a.id)).toEqual(['deep']);
  });

  it('ignores unresolvable subflow targets (validation reports those, not the walker)', () => {
    const outer = { id: 'o', nodes: [triggerNode, subflowNode('s', 'ghost')], edges: [] };
    expect([...walkAgents(outer as never, () => undefined)]).toEqual([]);
  });
});
