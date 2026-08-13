/**
 * Conformance fixtures — executable spec data.
 *
 * Each case is plain data (no functions) so any consumer can replay
 * them: flow-spec's own tests, harness-core's conformance suite (which
 * proves the runtime's re-exported evaluator matches the spec), a
 * future designer UI's preview tests, or a future Java-side validator.
 *
 * When expression semantics change, change the fixture here FIRST —
 * every conforming implementation then fails until it catches up.
 */
import type { Expression } from './types.ts';

export interface ExpressionCase {
  name: string;
  expr: Expression;
  state: unknown;
  expected: boolean;
  /** When present, conforming implementations must ALSO assert that
   *  `resolveExpressionValue(expr, state)` deep-equals this value —
   *  pins value semantics (constructors, raw lookups), not just the
   *  predicate coercion. Must stay JSON-serializable. */
  expectedValue?: unknown;
}

const STATE = {
  output: 'hello',
  review: { score: 0.9, approved: true },
  repos: ['api', 'web'],
  count: '10',
  summary: 'APPROVED: ship it',
  maybeNull: null,
};

export const EXPRESSION_CASES: readonly ExpressionCase[] = [
  {
    name: 'literal truthy value passes',
    expr: { kind: 'literal', value: 'yes' },
    state: STATE,
    expected: true,
  },
  {
    name: 'literal falsy value fails',
    expr: { kind: 'literal', value: 0 },
    state: STATE,
    expected: false,
  },
  {
    name: 'jsonpath dot-path hit is truthy',
    expr: { kind: 'jsonpath', path: '$.review.score' },
    state: STATE,
    expected: true,
  },
  {
    name: 'jsonpath miss through non-object is falsy, never throws',
    expr: { kind: 'jsonpath', path: '$.output.deep.deeper' },
    state: STATE,
    expected: false,
  },
  {
    name: 'jsonpath root $ returns whole state (truthy for objects)',
    expr: { kind: 'jsonpath', path: '$' },
    state: STATE,
    expected: true,
  },
  {
    name: 'jsonpath dot-numeric array indexing is supported: $.repos.0',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.repos.0' },
      op: '==',
      rhs: { kind: 'literal', value: 'api' },
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'jsonpath out-of-bounds array index resolves undefined (falsy)',
    expr: { kind: 'jsonpath', path: '$.repos.9' },
    state: STATE,
    expected: false,
  },
  {
    name: 'compare == is strict: string "5" never equals number 5',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: '5' },
      op: '==',
      rhs: { kind: 'literal', value: 5 },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'compare == on objects is reference equality: structurally equal objects are not ==',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.review' },
      op: '==',
      rhs: { kind: 'literal', value: { score: 0.9, approved: true } },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'compare > coerces numeric strings via Number()',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.count' },
      op: '>',
      rhs: { kind: 'literal', value: 5 },
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'compare numeric op with NaN on either side is false',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: 'not-a-number' },
      op: '>=',
      rhs: { kind: 'literal', value: 0 },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'in matches array membership by strict equality',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: 'api' },
      op: 'in',
      rhs: { kind: 'jsonpath', path: '$.repos' },
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'in with non-array rhs is false (no substring semantics)',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: 'ell' },
      op: 'in',
      rhs: { kind: 'jsonpath', path: '$.output' },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'all([]) is vacuously true',
    expr: { kind: 'all', exprs: [] },
    state: STATE,
    expected: true,
  },
  {
    name: 'any([]) is vacuously false',
    expr: { kind: 'any', exprs: [] },
    state: STATE,
    expected: false,
  },
  {
    name: 'not inverts the inner predicate',
    expr: { kind: 'not', expr: { kind: 'jsonpath', path: '$.missing' } },
    state: STATE,
    expected: true,
  },
  {
    name: 'jsonpath reads the job input via $.input',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.input.task' },
      op: '==',
      rhs: { kind: 'literal', value: 'fix-bug' },
    },
    state: { input: { task: 'fix-bug' }, output: '', nodes: {} },
    expected: true,
  },
  {
    name: 'jsonpath reads structured node output via $.nodes.<id>',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.nodes.review.score' },
      op: '>',
      rhs: { kind: 'literal', value: 0.8 },
    },
    state: { input: null, output: '{"score":0.9}', nodes: { review: { score: 0.9 } } },
    expected: true,
  },
  {
    name: 'contains matches substring on strings',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.summary' },
      op: 'contains',
      rhs: { kind: 'literal', value: 'APPROVED' },
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'contains with a non-string side is false (no coercion)',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.review' },
      op: 'contains',
      rhs: { kind: 'literal', value: 'x' },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'startsWith / endsWith are string prefix / suffix checks',
    expr: {
      kind: 'all',
      exprs: [
        {
          kind: 'compare',
          lhs: { kind: 'jsonpath', path: '$.summary' },
          op: 'startsWith',
          rhs: { kind: 'literal', value: 'APPROVED' },
        },
        {
          kind: 'compare',
          lhs: { kind: 'jsonpath', path: '$.summary' },
          op: 'endsWith',
          rhs: { kind: 'literal', value: 'it' },
        },
      ],
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'matches applies rhs as a regular expression',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.summary' },
      op: 'matches',
      rhs: { kind: 'literal', value: '^APPROVED' },
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'exists is true for present-but-null values',
    expr: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.maybeNull' } },
    state: STATE,
    expected: true,
  },
  {
    name: 'exists is false for missing paths (unlike truthiness)',
    expr: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.nope' } },
    state: STATE,
    expected: false,
  },
  {
    name: 'exists distinguishes false from missing',
    expr: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.flagOff' } },
    state: { flagOff: false },
    expected: true,
  },
  {
    name: 'object constructor resolves fields against state',
    expr: { kind: 'object', fields: { first: { kind: 'jsonpath', path: '$.repos.0' } } },
    state: STATE,
    expected: true,
    expectedValue: { first: 'api' },
  },
  {
    name: 'array constructor resolves items against state',
    expr: {
      kind: 'array',
      items: [
        { kind: 'jsonpath', path: '$.count' },
        { kind: 'literal', value: 7 },
      ],
    },
    state: STATE,
    expected: true,
    expectedValue: ['10', 7],
  },
  {
    name: 'nested composition: all(compare, not(any(...)))',
    expr: {
      kind: 'all',
      exprs: [
        {
          kind: 'compare',
          lhs: { kind: 'jsonpath', path: '$.review.approved' },
          op: '==',
          rhs: { kind: 'literal', value: true },
        },
        {
          kind: 'not',
          expr: {
            kind: 'any',
            exprs: [{ kind: 'jsonpath', path: '$.cancelRequested' }],
          },
        },
      ],
    },
    state: STATE,
    expected: true,
  },
];

// ─── Validation-verdict fixtures ─────────────────────────────────────────
//
// Same replay discipline as EXPRESSION_CASES, for the validator's
// accept/reject behavior: any conforming validator (this package's,
// harness-core's re-export, a future Java-side one) must agree on
// which catalogs are valid and locate errors the same way.

export interface ValidationCase {
  name: string;
  /** Passed verbatim to validateFlowCatalog(catalog, 'fixture'). */
  catalog: unknown;
  valid: boolean;
  /** Substring the CatalogError message must contain when valid=false. */
  errorIncludes?: string;
}

/** Shared minimal valid flow used as the base for invalid variations. */
const VALID_FLOW = {
  id: 'demo',
  nodes: [
    { id: 't', kind: 'trigger', config: { kind: 'manual' } },
    { id: 'a', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
  ],
  edges: [{ from: 't', to: 'a', type: 'sequence' }],
};

export const VALIDATION_CASES: readonly ValidationCase[] = [
  {
    name: 'minimal valid catalog is accepted',
    catalog: { flows: [VALID_FLOW] },
    valid: true,
  },
  {
    name: 'missing flows array is rejected',
    catalog: {},
    valid: false,
    errorIncludes: 'missing "flows" array',
  },
  {
    name: 'edge to an unknown node is rejected with the node named',
    catalog: {
      flows: [{ ...VALID_FLOW, edges: [{ from: 't', to: 'ghost', type: 'sequence' }] }],
    },
    valid: false,
    errorIncludes: 'unknown node "ghost"',
  },
  {
    name: 'cycles on non-reject edges are rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          edges: [
            { from: 't', to: 'a', type: 'sequence' },
            { from: 'a', to: 'a', type: 'sequence' },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'cycle detected',
  },
  {
    name: 'unknown compare op is rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              config: {
                expression: {
                  kind: 'compare',
                  lhs: { kind: 'literal', value: 1 },
                  op: '~=',
                  rhs: { kind: 'literal', value: 1 },
                },
              },
            },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'op must be one of',
  },
  {
    name: 'invalid literal regex for matches is rejected at load time',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              config: {
                expression: {
                  kind: 'compare',
                  lhs: { kind: 'literal', value: 'x' },
                  op: 'matches',
                  rhs: { kind: 'literal', value: '(' },
                },
              },
            },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'not a valid regular expression',
  },
  {
    name: 'two catch-all error edges from one source are rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            ...VALID_FLOW.nodes,
            { id: 'b', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            { id: 'c', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
          ],
          edges: [
            { from: 't', to: 'a', type: 'sequence' },
            { from: 'a', to: 'b', type: 'error' },
            { from: 'a', to: 'c', type: 'error' },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: "at most one catch-all 'error' edge",
  },
  {
    name: 'job-definition flow without job-intent output is rejected',
    catalog: { flows: [{ ...VALID_FLOW, kind: 'job-definition' }] },
    valid: false,
    errorIncludes: "requires output.kind 'job-intent'",
  },
  {
    name: 'duplicate node ids are rejected',
    catalog: {
      flows: [{ ...VALID_FLOW, nodes: [...VALID_FLOW.nodes, VALID_FLOW.nodes[1]] }],
    },
    valid: false,
    errorIncludes: 'duplicate node id',
  },
  {
    name: 'jsonpath root $, dot-numeric indexes, and nested dot-paths are accepted',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              config: {
                expression: {
                  kind: 'object',
                  fields: {
                    whole: { kind: 'jsonpath', path: '$' },
                    first: { kind: 'jsonpath', path: '$.repos.0' },
                    deep: { kind: 'jsonpath', path: '$.nodes.review.score' },
                  },
                },
              },
            },
          ],
        },
      ],
    },
    valid: true,
  },
  {
    name: 'jsonpath path without the $ prefix is rejected at load time',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              config: { expression: { kind: 'jsonpath', path: 'output' } },
            },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: "must be '$' or start with '$.'",
  },
  {
    name: 'jsonpath path with an empty segment is rejected at load time',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              config: { expression: { kind: 'jsonpath', path: '$.a..b' } },
            },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'empty segment',
  },
  {
    name: 'error name shadowed by an earlier error edge from the same source is rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            ...VALID_FLOW.nodes,
            { id: 'h1', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            { id: 'h2', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
          ],
          edges: [
            { from: 't', to: 'a', type: 'sequence' },
            { from: 'a', to: 'h1', type: 'error', on: ['Timeout'] },
            { from: 'a', to: 'h2', type: 'error', on: ['Timeout', 'RateLimitError'] },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'can never fire',
  },
  {
    name: 'job-intents contract with min greater than max is rejected',
    catalog: {
      flows: [{ ...VALID_FLOW, output: { kind: 'job-intents', min: 5, max: 2 } }],
    },
    valid: false,
    errorIncludes: 'must not exceed',
  },
  {
    name: 'joinStrategy node with an incoming error edge is rejected (joins count forward edges only)',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            ...VALID_FLOW.nodes,
            { id: 'b', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            {
              id: 'j',
              kind: 'transform',
              joinStrategy: 'all',
              config: { expression: { kind: 'literal', value: 1 } },
            },
          ],
          edges: [
            { from: 't', to: 'a', type: 'sequence' },
            { from: 't', to: 'b', type: 'sequence' },
            { from: 'a', to: 'j', type: 'sequence' },
            { from: 'b', to: 'j', type: 'error' },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'forward (sequence/conditional) incoming edges',
  },
];

// ─── Unsupported-feature fixtures ────────────────────────────────────────
//
// The teeth behind the README rule ("delete the report in the change
// that implements the feature"): replayers compare the EXACT sorted
// feature list, so a stale report (implemented but still warned) AND a
// missing report (new dead config, no warning) both fail every
// conforming validator until this fixture is updated FIRST.

export interface UnsupportedCase {
  name: string;
  /** A single FlowDef; replayers wrap it as `{ flows: [flow] }`. */
  flow: unknown;
  /** Exact (sorted-compare) list of feature ids the validator must
   *  report — no more, no fewer. */
  expectedFeatures: readonly string[];
}

export const UNSUPPORTED_CASES: readonly UnsupportedCase[] = [
  {
    name: 'every currently-unexecuted feature reports exactly once',
    flow: {
      id: 'kitchen-sink',
      output: { kind: 'structured', schema: { type: 'object' } },
      nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'schedule', cron: '0 * * * *' } },
        {
          id: 'a',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 1 } },
          policy: { retry: { maxAttempts: 2 } },
          joinStrategy: 'any',
          effect: 'pure',
          output: { kind: 'json', schema: { type: 'object' } },
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
        { id: 's', kind: 'subflow', config: { flowId: 'inner', version: '1.0.0' } },
      ],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
        { from: 'a', to: 'c', type: 'sequence' },
        { from: 'b', to: 's', type: 'sequence' },
      ],
    },
    // 'effect', 'policy', 'joinStrategy', and 'parallel-fan-out' are
    // deliberately absent: the kitchen-sink flow still declares all of
    // them (effect + policy + joinStrategy on node 'a'; two sequence
    // edges from 'a'), pinning that they are executed and no longer
    // reported.
    expectedFeatures: [
      'expression-js',
      'flow-output-schema',
      'node-output-schema',
      'subflow-version-pin',
      'terminal-fail',
      'trigger-schedule',
    ],
  },
  {
    name: 'fully-executed features produce zero reports',
    flow: {
      id: 'all-executed',
      version: '1.0.0',
      nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'manual' } },
        {
          id: 'sh',
          kind: 'script',
          effect: 'side-effecting',
          config: {
            language: 'bash',
            source: 'true',
            secrets: { API_KEY: { credentialId: 'anthropic' } },
          },
        },
        {
          id: 'shape',
          kind: 'transform',
          input: { task: { kind: 'jsonpath', path: '$.input' } },
          output: { kind: 'json' },
          config: {
            expression: {
              kind: 'object',
              fields: { ok: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.output' } } },
            },
          },
        },
        {
          id: 'check',
          kind: 'gate',
          config: {
            assertions: [
              {
                expression: {
                  kind: 'compare',
                  lhs: { kind: 'jsonpath', path: '$.output' },
                  op: 'contains',
                  rhs: { kind: 'literal', value: 'ok' },
                },
                message: 'output mentions ok',
              },
            ],
          },
        },
        {
          id: 'handled',
          kind: 'transform',
          config: { expression: { kind: 'literal', value: 'recovered' } },
        },
      ],
      edges: [
        { from: 't', to: 'sh', type: 'sequence' },
        { from: 'sh', to: 'shape', type: 'sequence' },
        { from: 'sh', to: 'handled', type: 'error', on: ['Timeout', 'AuthError'] },
        { from: 'shape', to: 'check', type: 'sequence' },
      ],
    },
    expectedFeatures: [],
  },
  {
    // js-SHAPED data in positions the runtime never evaluates is inert:
    // a literal's `value` is opaque data, and tool args are resolved
    // only when the top-level value is literal/jsonpath/js-shaped — a
    // compare-shaped arg (with a js inside) passes through as plain
    // data. Neither may report expression-js.
    name: 'inert js-shaped data (literal values, non-resolved tool args) reports nothing',
    flow: {
      id: 'inert-js',
      nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'manual' } },
        {
          id: 'a',
          kind: 'transform',
          config: {
            expression: {
              kind: 'literal',
              value: { kind: 'js', expression: 'ctx.score > 0.8' },
            },
          },
        },
        {
          id: 'b',
          kind: 'tool',
          config: {
            toolId: 'core:tools:jq',
            args: {
              plainData: {
                kind: 'compare',
                lhs: { kind: 'js', expression: '1' },
                op: '==',
                rhs: { kind: 'literal', value: 1 },
              },
            },
          },
        },
      ],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
      ],
    },
    expectedFeatures: [],
  },
  {
    // Every position the runtime DOES evaluate must still surface js:
    // event-trigger matcher, node input mapping, conditional edge
    // condition (nested), top-level tool arg, loop path, subflow input.
    // One expression-js report per occurrence (plus the trigger-event
    // report for the non-manual trigger).
    name: 'js in every live expression position reports once per occurrence',
    flow: {
      id: 'live-js',
      nodes: [
        {
          id: 't',
          kind: 'trigger',
          config: {
            kind: 'event',
            eventType: 'push',
            matcher: { kind: 'js', expression: 'event.branch === "main"' },
          },
        },
        {
          id: 'm',
          kind: 'transform',
          input: { ctx: { kind: 'js', expression: 'state.output' } },
          config: { expression: { kind: 'literal', value: 1 } },
        },
        {
          id: 'w',
          kind: 'tool',
          config: {
            toolId: 'core:tools:jq',
            args: { q: { kind: 'js', expression: '".files"' } },
          },
          tags: {
            loop: {
              source: 'collection',
              path: { kind: 'js', expression: 'state.repos' },
              mode: 'sequential',
            },
          },
        },
        {
          id: 'sf',
          kind: 'subflow',
          config: {
            flowId: 'inner',
            input: { seed: { kind: 'js', expression: 'state.count' } },
          },
        },
      ],
      edges: [
        { from: 't', to: 'm', type: 'sequence' },
        {
          from: 'm',
          to: 'w',
          type: 'conditional',
          condition: { kind: 'not', expr: { kind: 'js', expression: 'state.done' } },
        },
        { from: 'w', to: 'sf', type: 'sequence' },
      ],
    },
    expectedFeatures: [
      'expression-js',
      'expression-js',
      'expression-js',
      'expression-js',
      'expression-js',
      'expression-js',
      'trigger-event',
    ],
  },
];
