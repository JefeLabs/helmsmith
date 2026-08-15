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
    name: 'output schema using an unsupported keyword is rejected at load time',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              output: { kind: 'json', schema: { oneOf: [{ type: 'string' }] } },
              config: { expression: { kind: 'literal', value: 1 } },
            },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'unsupported keyword "oneOf"',
  },
  {
    name: 'structured flow-output schema with a malformed type is rejected at load time',
    catalog: {
      flows: [{ ...VALID_FLOW, output: { kind: 'structured', schema: { type: 'objct' } } }],
    },
    valid: false,
    errorIncludes: 'type must be one of',
  },
  {
    name: 'a recursive directory loop validates; a non-boolean recursive is rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              tags: {
                loop: {
                  source: 'directory',
                  path: { kind: 'jsonpath', path: '$.input' },
                  mode: 'parallel',
                  concurrency: 4,
                  recursive: true,
                },
              },
              config: { expression: { kind: 'literal', value: 1 } },
            },
          ],
        },
      ],
    },
    valid: true,
  },
  {
    name: 'a loop with a non-boolean recursive flag is rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              tags: {
                loop: {
                  source: 'directory',
                  path: { kind: 'jsonpath', path: '$.input' },
                  mode: 'sequential',
                  recursive: 'yes',
                },
              },
              config: { expression: { kind: 'literal', value: 1 } },
            },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'recursive must be a boolean',
  },
  {
    name: 'an agent with a custom (non-built-in) adapter id validates — adapters resolve at runtime',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'agent',
              config: { agent: { id: 'a', role: 'Worker', adapter: 'my-org:llama-local' } },
            },
          ],
        },
      ],
    },
    valid: true,
  },
  {
    name: 'an agent with an empty adapter id is rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            { id: 'a', kind: 'agent', config: { agent: { id: 'a', role: 'W', adapter: '' } } },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'adapter must be a non-empty string',
  },
  {
    name: 'a schedule trigger with a malformed cron field is rejected at load time',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'schedule', cron: '61 * * * *' } },
            VALID_FLOW.nodes[1],
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'cron',
  },
  {
    name: 'a schedule trigger with the wrong cron field count is rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'schedule', cron: '* * *' } },
            VALID_FLOW.nodes[1],
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: '5 fields',
  },
  {
    name: 'a schedule trigger declaring tz is rejected (schedules run in server-local time)',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            {
              id: 't',
              kind: 'trigger',
              config: { kind: 'schedule', cron: '0 9 * * *', tz: 'America/New_York' },
            },
            VALID_FLOW.nodes[1],
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'tz is not supported',
  },
  {
    name: 'a schedule trigger with subset cron grammar (steps, ranges, lists) is accepted',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            {
              id: 't',
              kind: 'trigger',
              config: { kind: 'schedule', cron: '*/15 9-17 1,15 * 1-5' },
            },
            VALID_FLOW.nodes[1],
          ],
        },
      ],
    },
    valid: true,
  },
  {
    name: "terminal:'fail' on a node with outgoing edges is rejected (failure endpoints are sinks)",
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'transform',
              terminal: 'fail',
              config: { expression: { kind: 'literal', value: 1 } },
            },
            { id: 'b', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
          ],
          edges: [
            { from: 't', to: 'a', type: 'sequence' },
            { from: 'a', to: 'b', type: 'sequence' },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'failure endpoints must be terminal',
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
  // ── Tool input-mechanism rule ─────────────────────────────────────
  // `input` composes the payload (rewrites the effective $.output the
  // executor sees); `args` bind the tool's named parameters. Templates
  // in a ToolDef resolve against resolved args ONLY, so the composed
  // payload reaches the tool exclusively through an args expression
  // reading $.output. Declaring `input` on a tool node with no such
  // arg is provably dead config — rejected like other statically-
  // knowable dead branches (shadowed error edges, unreachable joins).
  {
    name: 'tool node input mapping with no args expression reading $.output is rejected as dead config',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'tool',
              config: {
                toolId: 'core:tools:jq',
                args: { filter: { kind: 'literal', value: '.items' } },
              },
              input: { data: { kind: 'jsonpath', path: '$.nodes.build' } },
            },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'input mapping is dead config',
  },
  {
    name: 'tool node input mapping consumed via an args $.output expression is valid',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'tool',
              config: {
                toolId: 'core:tools:jq',
                args: {
                  filter: { kind: 'literal', value: '.items' },
                  payload: { kind: 'jsonpath', path: '$.output' },
                },
              },
              input: { data: { kind: 'jsonpath', path: '$.nodes.build' } },
            },
          ],
        },
      ],
    },
    valid: true,
  },
  {
    name: 'tool node input mapping consumed via a nested $.output path is valid',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'a',
              kind: 'tool',
              config: {
                toolId: 'core:tools:jq',
                // Single-Expression string mappings pass through raw, so
                // a dotted read INTO the payload also counts as consuming.
                args: { first: { kind: 'jsonpath', path: '$.output.items.0' } },
              },
              input: { kind: 'jsonpath', path: '$.nodes.build' },
            },
          ],
        },
      ],
    },
    valid: true,
  },
  // ── Join-hazard static analysis ───────────────────────────────────
  // A joinStrategy barrier counts arrivals from its forward-edge
  // sources. If fewer sources are GUARANTEED to run (on every
  // success-path execution) than the strategy requires, there exist
  // executions where the join never fires and its branch silently
  // ends — the wedge class documented since 2.4, now rejected at load.
  // Guarantee is a must-reach analysis over success routing: each
  // conditional edge is its own outcome; the else-outcome is the
  // sequence fan-out (or the fallback edge when no sequence exists);
  // a node with no forward outcome ends the branch. Joins inside
  // reject cycles are rejected too (the once-per-run marker never
  // resets across retries).
  {
    name: "an 'all' join over exclusively-conditional sources is rejected (it can never be satisfied)",
    catalog: {
      flows: [
        {
          id: 'demo',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'manual' } },
            { id: 'a', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            { id: 'b', kind: 'transform', config: { expression: { kind: 'literal', value: 2 } } },
            {
              id: 'j',
              kind: 'transform',
              joinStrategy: 'all',
              config: { expression: { kind: 'literal', value: 3 } },
            },
          ],
          edges: [
            // t routes to EXACTLY ONE of a|b — the 'all' join needs both.
            {
              from: 't',
              to: 'a',
              type: 'conditional',
              condition: { kind: 'literal', value: true },
            },
            {
              from: 't',
              to: 'b',
              type: 'conditional',
              condition: { kind: 'literal', value: false },
            },
            { from: 'a', to: 'j', type: 'sequence' },
            { from: 'b', to: 'j', type: 'sequence' },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'guaranteed to run',
  },
  {
    name: "an 'all' join over a diamond-converged source is valid (must-reach sees through exhaustive branching)",
    catalog: {
      flows: [
        {
          id: 'demo',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'manual' } },
            { id: 'x', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            { id: 'y', kind: 'transform', config: { expression: { kind: 'literal', value: 2 } } },
            { id: 's', kind: 'transform', config: { expression: { kind: 'literal', value: 3 } } },
            { id: 'w', kind: 'transform', config: { expression: { kind: 'literal', value: 4 } } },
            {
              id: 'j',
              kind: 'transform',
              joinStrategy: 'all',
              config: { expression: { kind: 'literal', value: 5 } },
            },
          ],
          edges: [
            // t: conditional→x, sequence→y (the else) — EVERY execution
            // takes one branch, and both branches converge on s.
            {
              from: 't',
              to: 'x',
              type: 'conditional',
              condition: { kind: 'literal', value: true },
            },
            { from: 't', to: 'y', type: 'sequence' },
            { from: 'x', to: 's', type: 'sequence' },
            { from: 'y', to: 's', type: 'sequence' },
            // s fans out to w and j; w also feeds j — both sources of
            // the 'all' join are guaranteed.
            { from: 's', to: 'w', type: 'sequence' },
            { from: 's', to: 'j', type: 'sequence' },
            { from: 'w', to: 'j', type: 'sequence' },
          ],
        },
      ],
    },
    valid: true,
  },
  {
    name: "an 'any' join with one guaranteed source among conditional ones is valid",
    catalog: {
      flows: [
        {
          id: 'demo',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'manual' } },
            { id: 'g', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            { id: 'h', kind: 'transform', config: { expression: { kind: 'literal', value: 2 } } },
            { id: 'c', kind: 'transform', config: { expression: { kind: 'literal', value: 3 } } },
            {
              id: 'j',
              kind: 'transform',
              joinStrategy: 'any',
              config: { expression: { kind: 'literal', value: 4 } },
            },
          ],
          edges: [
            // Fan-out: g and h BOTH always run; c runs only when h's
            // conditional matches (no else on h). 'any' needs one
            // guaranteed source — g qualifies.
            { from: 't', to: 'g', type: 'sequence' },
            { from: 't', to: 'h', type: 'sequence' },
            {
              from: 'h',
              to: 'c',
              type: 'conditional',
              condition: { kind: 'literal', value: true },
            },
            { from: 'g', to: 'j', type: 'sequence' },
            { from: 'c', to: 'j', type: 'sequence' },
          ],
        },
      ],
    },
    valid: true,
  },
  {
    name: 'an nOfM join requiring more sources than are guaranteed is rejected',
    catalog: {
      flows: [
        {
          id: 'demo',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'manual' } },
            { id: 'g', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            { id: 'h', kind: 'transform', config: { expression: { kind: 'literal', value: 2 } } },
            { id: 'c1', kind: 'transform', config: { expression: { kind: 'literal', value: 3 } } },
            { id: 'c2', kind: 'transform', config: { expression: { kind: 'literal', value: 4 } } },
            {
              id: 'j',
              kind: 'transform',
              joinStrategy: { nOfM: 2 },
              config: { expression: { kind: 'literal', value: 5 } },
            },
          ],
          edges: [
            { from: 't', to: 'g', type: 'sequence' },
            { from: 't', to: 'h', type: 'sequence' },
            // c1/c2 are h's exclusive conditional branches — at most one
            // runs. Guaranteed sources of j: only g. nOfM 2 > 1.
            {
              from: 'h',
              to: 'c1',
              type: 'conditional',
              condition: { kind: 'literal', value: true },
            },
            {
              from: 'h',
              to: 'c2',
              type: 'conditional',
              condition: { kind: 'literal', value: false },
            },
            { from: 'g', to: 'j', type: 'sequence' },
            { from: 'c1', to: 'j', type: 'sequence' },
            { from: 'c2', to: 'j', type: 'sequence' },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'guaranteed to run',
  },
  {
    name: 'a join node inside a reject cycle is rejected (the once-per-run barrier never resets)',
    catalog: {
      flows: [
        {
          id: 'demo',
          nodes: [
            { id: 't', kind: 'trigger', config: { kind: 'manual' } },
            { id: 'fix', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
            {
              id: 'j',
              kind: 'transform',
              joinStrategy: 'all',
              config: { expression: { kind: 'literal', value: 2 } },
            },
            {
              id: 'check',
              kind: 'gate',
              config: {
                assertions: [{ expression: { kind: 'literal', value: true }, message: 'ok' }],
              },
            },
          ],
          edges: [
            { from: 't', to: 'fix', type: 'sequence' },
            { from: 'fix', to: 'j', type: 'sequence' },
            { from: 'j', to: 'check', type: 'sequence' },
            { from: 'check', to: 'fix', type: 'reject', maxAttempts: 3 },
          ],
        },
      ],
    },
    valid: false,
    errorIncludes: 'reject cycle',
  },
  // ── AgentDef.bootstrap ──────────────────────────────────────────────
  // Every implementation of this contract must agree on these, including
  // the metacharacter case: the steps run as argv WITHOUT a shell, so a
  // validator that "hardens" by rejecting `;` breaks legitimate arguments
  // and diverges from the reference.
  {
    name: 'bootstrap on a CLI-backed adapter is accepted',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'b',
              kind: 'agent',
              config: {
                agent: {
                  id: 'b',
                  role: 'Builder',
                  adapter: 'copilot-cli',
                  bootstrap: [
                    {
                      run: [
                        'copilot',
                        'plugin',
                        'marketplace',
                        'add',
                        'obra/superpowers-marketplace',
                      ],
                      description: 'Register the marketplace this plugin comes from.',
                    },
                    {
                      run: ['copilot', 'plugin', 'install', 'superpowers@superpowers-marketplace'],
                    },
                  ],
                },
              },
            },
          ],
          edges: [{ from: 't', to: 'b', type: 'sequence' }],
        },
      ],
    },
    valid: true,
  },
  {
    name: 'bootstrap on a non-CLI adapter is rejected',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'b',
              kind: 'agent',
              config: {
                agent: {
                  id: 'b',
                  role: 'Builder',
                  adapter: 'claude-sdk',
                  bootstrap: [{ run: ['copilot', 'plugin', 'install', 'x'] }],
                },
              },
            },
          ],
          edges: [{ from: 't', to: 'b', type: 'sequence' }],
        },
      ],
    },
    valid: false,
    errorIncludes: 'only supported on CLI-backed adapters',
  },
  {
    name: 'an empty bootstrap list is rejected as dead config',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'b',
              kind: 'agent',
              config: {
                agent: { id: 'b', role: 'Builder', adapter: 'copilot-cli', bootstrap: [] },
              },
            },
          ],
          edges: [{ from: 't', to: 'b', type: 'sequence' }],
        },
      ],
    },
    valid: false,
    errorIncludes: 'must not be empty when present',
  },
  {
    name: 'shell metacharacters in argv are accepted (argv is not a shell)',
    catalog: {
      flows: [
        {
          ...VALID_FLOW,
          nodes: [
            VALID_FLOW.nodes[0],
            {
              id: 'b',
              kind: 'agent',
              config: {
                agent: {
                  id: 'b',
                  role: 'Builder',
                  adapter: 'copilot-cli',
                  bootstrap: [{ run: ['mytool', '--glob', 'src/**/*.ts;'] }],
                },
              },
            },
          ],
          edges: [{ from: 't', to: 'b', type: 'sequence' }],
        },
      ],
    },
    valid: true,
  },
];

// ─── Schema-subset fixtures ──────────────────────────────────────────────
//
// Pin `schemaViolations` semantics (the 2.7 output-contract check) the
// same way EXPRESSION_CASES pin the evaluator: any conforming
// implementation must agree on which values violate which schemas.

export interface SchemaCase {
  name: string;
  schema: unknown;
  value: unknown;
  valid: boolean;
  /** Substring at least one violation must contain when valid=false. */
  violationIncludes?: string;
}

export const SCHEMA_CASES: readonly SchemaCase[] = [
  {
    name: 'conforming object passes',
    schema: {
      type: 'object',
      required: ['score'],
      properties: { score: { type: 'number', minimum: 0, maximum: 1 } },
    },
    value: { score: 0.9 },
    valid: true,
  },
  {
    name: 'missing required property is located',
    schema: { type: 'object', required: ['verdict'] },
    value: {},
    valid: false,
    violationIncludes: '$.verdict',
  },
  {
    name: 'wrong type short-circuits deeper checks',
    schema: { type: 'object', properties: { a: { type: 'string' } } },
    value: 'not-an-object',
    valid: false,
    violationIncludes: 'expected object',
  },
  {
    name: 'integer rejects fractional numbers',
    schema: { type: 'integer' },
    value: 2.5,
    valid: false,
    violationIncludes: 'expected integer',
  },
  {
    name: 'additionalProperties false rejects undeclared keys',
    schema: { type: 'object', additionalProperties: false, properties: { a: {} } },
    value: { a: 1, b: 2 },
    valid: false,
    violationIncludes: '$.b',
  },
  {
    name: 'array items are checked element-wise with an indexed path',
    schema: { type: 'array', items: { type: 'string' } },
    value: ['ok', 7],
    valid: false,
    violationIncludes: '$[1]',
  },
  {
    name: 'enum matches by deep equality',
    schema: { enum: [{ kind: 'approve' }, { kind: 'reject' }] },
    value: { kind: 'approve' },
    valid: true,
  },
  {
    name: 'multi-type accepts any listed type',
    schema: { type: ['string', 'null'] },
    value: null,
    valid: true,
  },
  {
    name: 'empty schema accepts anything',
    schema: {},
    value: { deeply: ['nested', 1] },
    valid: true,
  },
  {
    name: 'string bounds and pattern are enforced',
    schema: { type: 'string', minLength: 2, pattern: '^ok' },
    value: 'x',
    valid: false,
    violationIncludes: 'minLength',
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
    // All four non-manual trigger kinds are ingress-backed — no reports.
    name: 'ingress-backed triggers (schedule) report nothing',
    flow: {
      id: 'cron-flow',
      nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'schedule', cron: '*/15 9-17 * * 1-5' } },
        { id: 'a', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } } },
      ],
      edges: [{ from: 't', to: 'a', type: 'sequence' }],
    },
    expectedFeatures: [],
  },
  {
    name: 'every currently-unexecuted feature reports exactly once',
    flow: {
      id: 'kitchen-sink',
      output: { kind: 'structured', schema: { type: 'object' } },
      nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'message', channel: 'ops' } },
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
        },
        {
          id: 'c',
          kind: 'gate',
          config: {
            assertions: [{ expression: { kind: 'js', expression: 'true' }, message: 'x' }],
          },
        },
        {
          id: 's',
          kind: 'subflow',
          terminal: 'fail',
          config: { flowId: 'inner', version: '1.0.0' },
        },
      ],
      edges: [
        { from: 't', to: 'a', type: 'sequence' },
        { from: 'a', to: 'b', type: 'sequence' },
        { from: 'a', to: 'c', type: 'sequence' },
        { from: 'b', to: 's', type: 'sequence' },
      ],
    },
    // Every once-reported feature is deliberately absent — the
    // kitchen-sink flow still declares them all (message trigger,
    // effect, policy, joinStrategy, double sequence edge, schemas,
    // terminal:'fail' on leaf 's'), pinning that they are executed and
    // silent. Only expression-js (deliberate: no JS sandbox) and
    // subflow-version-pin remain reportable.
    expectedFeatures: ['expression-js', 'subflow-version-pin'],
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
    // The event trigger itself is ingress-backed (3.1) — no trigger
    // report; only its js matcher (and the other five) report.
    expectedFeatures: [
      'expression-js',
      'expression-js',
      'expression-js',
      'expression-js',
      'expression-js',
      'expression-js',
    ],
  },
];
