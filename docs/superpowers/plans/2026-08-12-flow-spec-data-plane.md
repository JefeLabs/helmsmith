# Flow-Spec Data Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the flow spec a real data-plane contract (node-addressable state, per-node structured output, node input mapping) plus the Tier-2/3 critique items (error-edge matchers, expression additions, effect classification, run-side wire shapes, flow versioning, script credential refs), implemented end-to-end in `@helmsmith/flow-spec` AND harness-core's runtime — never spec-only, so the honesty discipline holds.

**Architecture:** All changes are additive and opt-in. flow-spec gains new types + validation + fixtures first (fixture-first is the package's own discipline); harness-core catches up in the same branch so no new `onUnsupported` reports are needed except for the three genuinely-deferred features (`node-output-schema`, `effect`, `subflow-version-pin`). Runtime state gains two channels (`input`, `nodes`); node I/O behavior is implemented as executor wrappers in `compileFlow` so every step kind gets it uniformly.

**Tech Stack:** TypeScript (ESM, `.ts` imports), vitest, LangGraph `Annotation.Root` state, pnpm workspace. flow-spec must stay zero-dependency and browser-safe (no `node:*` imports).

## Global Constraints

- flow-spec: **zero runtime dependencies, no `node:*` imports** (browser-safe contract, SPEC.md §1).
- Dependency direction: harness-core → flow-spec, **never back**.
- The evaluator **never throws** on bad data (only on `js` kind); missing/mismatched values resolve to `undefined`/`false`.
- Fixtures (`EXPRESSION_CASES`) must stay **JSON-serializable** (guarded by an existing test).
- Honesty rule: any spec'd-but-unexecuted feature must be reported through `onUnsupported`; any feature this branch implements must NOT be reported.
- All existing tests must keep passing (`npx vitest run` in both `platform/harness/flow-spec` and `platform/harness/harness-core`).
- Commit per task on branch `feat/flow-spec-data-plane`; do NOT push without the user's say-so.
- Working dirs: spec = `platform/harness/flow-spec`, runtime = `platform/harness/harness-core` (paths below relative to repo root `helmsmith/`).

---

### Task 1: Expression language additions (spec)

New `CompareOp`s `contains | startsWith | endsWith | matches`; new Expression kinds `exists | object | array`; optional `expectedValue` on fixtures.

**Files:**
- Modify: `platform/harness/flow-spec/src/types.ts` (CompareOp ~line 572, Expression union ~line 584)
- Modify: `platform/harness/flow-spec/src/expression.ts`
- Modify: `platform/harness/flow-spec/src/fixtures.ts`
- Modify: `platform/harness/flow-spec/src/validate.ts` (`VALID_COMPARE_OPS`, `validateExpression`)
- Modify: `platform/harness/flow-spec/package.json` (add `"test": "vitest run"` — roadmap item 0.3, one line)
- Test: `platform/harness/flow-spec/src/expression.test.ts`, `src/validate.test.ts` (fixtures.test.ts replays new cases automatically)

**Interfaces:**
- Produces: `CompareOp` gains `'contains' | 'startsWith' | 'endsWith' | 'matches'`; `Expression` gains `{ kind: 'exists'; expr: Expression }`, `{ kind: 'object'; fields: Readonly<Record<string, Expression>> }`, `{ kind: 'array'; items: readonly Expression[] }`; `ExpressionCase` gains `expectedValue?: unknown` (checked via `resolveExpressionValue` when present).

**Semantics (document verbatim in code comments):**
- `contains`/`startsWith`/`endsWith`: both sides must be strings, else `false` (no coercion — consistent with `in`).
- `matches`: both sides strings; rhs compiled as `new RegExp(rhs)` (no flags); invalid pattern → `false`, never throws. Validator additionally rejects invalid patterns at load time when rhs is a string literal.
- `exists`: `resolveExpressionValue(expr) !== undefined`. `null` EXISTS (it is a present JSON value); only a missing path does not.
- `object`/`array`: constructors. As value → fields/items resolved through `resolveExpressionValue`. As predicate → always `true` (containers are truthy).

- [ ] **Step 1: Write failing tests** — in `expression.test.ts` add value-level tests:

```ts
describe('object / array constructors', () => {
  it('object resolves each field against state', () => {
    const expr: Expression = {
      kind: 'object',
      fields: {
        item: { kind: 'jsonpath', path: '$.repos.0' },
        max: { kind: 'literal', value: 3 },
      },
    };
    expect(resolveExpressionValue(expr, { repos: ['api'] })).toEqual({ item: 'api', max: 3 });
  });
  it('array resolves each item against state', () => {
    const expr: Expression = {
      kind: 'array',
      items: [{ kind: 'jsonpath', path: '$.a' }, { kind: 'literal', value: 2 }],
    };
    expect(resolveExpressionValue(expr, { a: 1 })).toEqual([1, 2]);
  });
  it('constructors are truthy as predicates', () => {
    expect(evalExpression({ kind: 'object', fields: {} }, {})).toBe(true);
    expect(evalExpression({ kind: 'array', items: [] }, {})).toBe(true);
  });
});
describe('matches never throws', () => {
  it('invalid pattern from state is false', () => {
    const expr: Expression = {
      kind: 'compare',
      lhs: { kind: 'literal', value: 'abc' },
      op: 'matches',
      rhs: { kind: 'jsonpath', path: '$.pat' },
    };
    expect(evalExpression(expr, { pat: '(' })).toBe(false);
  });
});
```

- [ ] **Step 2: Add fixtures** to `EXPRESSION_CASES` (all JSON-serializable; state extends the existing `STATE` const):

```ts
// Append to STATE: summary: 'APPROVED: ship it', maybeNull: null
{ name: 'contains matches substring on strings', expr: { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.summary' }, op: 'contains', rhs: { kind: 'literal', value: 'APPROVED' } }, state: STATE, expected: true },
{ name: 'contains with non-string side is false', expr: { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.review' }, op: 'contains', rhs: { kind: 'literal', value: 'x' } }, state: STATE, expected: false },
{ name: 'startsWith / endsWith are string-prefix/suffix', expr: { kind: 'all', exprs: [ { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.summary' }, op: 'startsWith', rhs: { kind: 'literal', value: 'APPROVED' } }, { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.summary' }, op: 'endsWith', rhs: { kind: 'literal', value: 'it' } } ] }, state: STATE, expected: true },
{ name: 'matches applies rhs as a regular expression', expr: { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.summary' }, op: 'matches', rhs: { kind: 'literal', value: '^APPROVED' } }, state: STATE, expected: true },
{ name: 'exists is true for present-but-null values', expr: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.maybeNull' } }, state: STATE, expected: true },
{ name: 'exists is false for missing paths (unlike truthiness)', expr: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.nope' } }, state: STATE, expected: false },
{ name: 'exists distinguishes false from missing', expr: { kind: 'exists', expr: { kind: 'jsonpath', path: '$.flagOff' } }, state: { flagOff: false }, expected: true },
{ name: 'object constructor as value', expr: { kind: 'object', fields: { first: { kind: 'jsonpath', path: '$.repos.0' } } }, state: STATE, expected: true, expectedValue: { first: 'api' } },
```

Also extend `ExpressionCase` with `expectedValue?: unknown` and update `fixtures.test.ts` to assert `resolveExpressionValue(c.expr, c.state)` deep-equals `c.expectedValue` when the field is present.

- [ ] **Step 3: Run to verify failure** — `cd platform/harness/flow-spec && npx vitest run` → new tests fail (unknown kinds throw TS errors / evaluator falls through).

- [ ] **Step 4: Implement** — types.ts, expression.ts, validate.ts per the exact code below.

types.ts:
```ts
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in'
  | 'contains' | 'startsWith' | 'endsWith' | 'matches';
// Expression union — add:
  | { kind: 'exists'; expr: Expression }
  | { kind: 'object'; fields: Readonly<Record<string, Expression>> }
  | { kind: 'array'; items: readonly Expression[] }
```

expression.ts `evalCompare` — add before the closing brace:
```ts
    case 'contains':
    case 'startsWith':
    case 'endsWith': {
      if (typeof lhsValue !== 'string' || typeof rhsValue !== 'string') return false;
      if (op === 'contains') return lhsValue.includes(rhsValue);
      if (op === 'startsWith') return lhsValue.startsWith(rhsValue);
      return lhsValue.endsWith(rhsValue);
    }
    case 'matches': {
      if (typeof lhsValue !== 'string' || typeof rhsValue !== 'string') return false;
      try {
        return new RegExp(rhsValue).test(lhsValue);
      } catch {
        return false;
      }
    }
```

expression.ts `evalExpression` — add cases:
```ts
    case 'exists':
      return resolveExpressionValue(expr.expr, state) !== undefined;
    case 'object':
    case 'array':
      return true;
```

expression.ts `resolveExpressionValue` — add cases:
```ts
    case 'exists':
      return evalExpression(expr, state);
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(expr.fields)) out[k] = resolveExpressionValue(sub, state);
      return out;
    }
    case 'array':
      return expr.items.map((sub) => resolveExpressionValue(sub, state));
```

validate.ts — add the four ops to `VALID_COMPARE_OPS`; in `validateExpression` add cases `exists` (validate `.expr`), `object` (fields must be plain object; each value validated), `array` (items must be array; each validated); in the `compare` case, after validating lhs/rhs, add the load-time regex check:
```ts
      if (e.op === 'matches') {
        const rhs = e.rhs as Record<string, unknown> | undefined;
        if (rhs && rhs.kind === 'literal' && typeof rhs.value === 'string') {
          try {
            new RegExp(rhs.value);
          } catch (err) {
            throw new CatalogError(`${where}.rhs is not a valid regular expression: ${(err as Error).message}`);
          }
        }
      }
```
Update the default-case kind list message to include `exists, object, array`. Add validate.test cases: valid exists/object/array accepted; `{kind:'object', fields: []}` rejected; invalid literal regex for `matches` rejected with "not a valid regular expression".

- [ ] **Step 5: Run to verify pass** — `npx vitest run` in flow-spec: all green (17 + new fixtures).
- [ ] **Step 6: Commit** — `git checkout -b feat/flow-spec-data-plane && git add -A && git commit -m "feat(flow-spec): expression additions — exists, object/array constructors, string compare ops"`

### Task 2: Run-side wire contract in flow-spec (`FlowRunState`, `NodeExit`, HITL shapes, `ChangedFile`)

**Files:**
- Modify: `platform/harness/flow-spec/src/types.ts` (append a "Run-side wire shapes" section)
- Modify: `platform/harness/flow-spec/src/fixtures.ts` (`$.input` / `$.nodes` cases)
- Modify: `platform/harness/harness-core/src/changed-files.ts` (ChangedFile becomes re-export)
- Modify: `platform/harness/harness-core/src/flow-graph.ts` (NodeExit/ApprovalRequest/ApprovalResume/SuspendRequest become re-exports)
- Test: existing suites in both packages (type moves must be behavior-neutral)

**Interfaces:**
- Produces (flow-spec): `NodeExit { nodeId: string; kind: 'success' | 'error' | 'reject'; errorName?: string; errorMessage?: string }`; `ChangedFile` (copied verbatim from `changed-files.ts:36`, including `id, repo, path, filename, changeKind, statusCode, previousPath?, mimeType`); `ApprovalRequest`, `ApprovalResume`, `SuspendRequest` (copied verbatim from `flow-graph.ts:214-273`); and:

```ts
/** The routable run-state surface — the shape jsonpath expressions bind
 *  against at runtime. harness-core's FlowState channels must remain
 *  structurally assignable to this (compile-time-asserted there). */
export interface FlowRunState {
  jobId: string;
  /** Job/trigger payload. Seeded once at start; never overwritten by nodes. */
  input: unknown;
  /** Latest text output (legacy single channel; last-write-wins). */
  output: string;
  /** Per-node outputs, keyed by node id. Structured when the node
   *  declares output.kind 'json'; the raw output string otherwise. */
  nodes: Record<string, unknown>;
  messages: unknown[];
  attempts: Record<string, number>;
  lastExit: NodeExit | null;
  rejectionPayload: RejectionPayload | null;
  steering: string[];
  cancelRequested: boolean;
  cancelReason: string | null;
  changedFiles: ChangedFile[];
}
```

- harness-core keeps its exports working via `import type { ... } from '@helmsmith/flow-spec'` + `export type { ... }` in the same files that used to define them (so `harness-core/src/index.ts` and external consumers are untouched).

- [ ] **Step 1:** Add the types to flow-spec (exact shapes above; copy ApprovalRequest/ApprovalResume/SuspendRequest/ChangedFile doc comments along).
- [ ] **Step 2:** Add fixtures:

```ts
{ name: 'jsonpath reads the job input via $.input', expr: { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.input.task' }, op: '==', rhs: { kind: 'literal', value: 'fix-bug' } }, state: { input: { task: 'fix-bug' }, output: '', nodes: {} }, expected: true },
{ name: 'jsonpath reads structured node output via $.nodes.<id>', expr: { kind: 'compare', lhs: { kind: 'jsonpath', path: '$.nodes.review.score' }, op: '>', rhs: { kind: 'literal', value: 0.8 } }, state: { input: null, output: '{"score":0.9}', nodes: { review: { score: 0.9 } } }, expected: true },
```

- [ ] **Step 3:** In harness-core, delete the local definitions of `NodeExit` (flow-graph.ts:71-77), `ApprovalRequest`/`ApprovalResume`/`SuspendRequest` (flow-graph.ts:214-273), `ChangedFile` (changed-files.ts:36-57) and replace with imports + re-exports, e.g. in flow-graph.ts:

```ts
import type { ApprovalRequest, ApprovalResume, NodeExit, SuspendRequest } from '@helmsmith/flow-spec';
export type { ApprovalRequest, ApprovalResume, NodeExit, SuspendRequest };
```

(and in changed-files.ts: `import type { ChangedFile } from '@helmsmith/flow-spec'; export type { ChangedFile };`). flow-graph.ts's local `import type { ChangedFile } from './changed-files.ts'` keeps working.
- [ ] **Step 4:** Run both suites: `cd platform/harness/flow-spec && npx vitest run && cd ../harness-core && npx vitest run` → green (pure type moves).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(flow-spec): run-side wire contract — FlowRunState, NodeExit, HITL request/resume shapes, ChangedFile"`

### Task 3: New spec fields — `TaskStep.input/output/effect`, `FlowDef.version`, subflow version pin, `ScriptConfig.secrets`

**Files:**
- Modify: `platform/harness/flow-spec/src/types.ts`
- Modify: `platform/harness/flow-spec/src/validate.ts`
- Test: `platform/harness/flow-spec/src/validate.test.ts`

**Interfaces (produces):**
```ts
/** Per-node output contract. 'json' → the runtime parses the node's
 *  output string as JSON into state.nodes[id]; parse failure exits the
 *  node with errorName 'OutputParseError' (routable via error edge).
 *  schema is declared-but-not-enforced (reported via onUnsupported). */
export type NodeOutputContract = { kind: 'text' } | { kind: 'json'; schema?: unknown };
```
- `TaskStep` gains: `input?: Expression | Readonly<Record<string, Expression>>;` `output?: NodeOutputContract;` `effect?: 'pure' | 'idempotent' | 'side-effecting';`
- `FlowDef` gains `version?: string;` — `SubflowConfig` gains `version?: string;` — `ScriptConfig` gains `secrets?: Readonly<Record<string, { credentialId: string }>>;`
- Input-mapping doc rule: an object with a string `kind` field is treated as a single Expression; therefore mapping keys must not be named `kind`.

- [ ] **Step 1: Write failing validate tests** (representative set — write all of these):

```ts
it('accepts node input mapping and rejects a non-expression value', () => {
  const flow = flowWith({ id: 'a', kind: 'transform', config: { expression: LIT }, input: { context: { kind: 'jsonpath', path: '$.nodes.plan' } } });
  expect(() => validateFlowCatalog({ flows: [flow] }, 't')).not.toThrow();
  const bad = flowWith({ id: 'a', kind: 'transform', config: { expression: LIT }, input: { context: 5 } });
  expect(() => validateFlowCatalog({ flows: [bad] }, 't')).toThrow(/input\.context/);
});
it('accepts output contract json and rejects schema on text', () => { /* output: {kind:'json'} ok; {kind:'text', schema:{}} throws /schema is only allowed/ */ });
it('rejects unknown effect values', () => { /* effect: 'sometimes' throws /effect must be/ */ });
it('accepts flow version and subflow version pin; reports subflow-version-pin as unsupported', () => { /* collect via onUnsupported */ });
it('reports node-output-schema when json schema declared', () => { /* output: {kind:'json', schema:{type:'object'}} → feature 'node-output-schema' */ });
it('reports effect as unsupported', () => { /* effect: 'pure' → feature 'effect' */ });
it('validates script secrets shape', () => { /* secrets: {API_KEY:{credentialId:'anthropic'}} ok; {API_KEY:{}} throws /credentialId/ */ });
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — types per above. validate.ts:
  - In `validateNode` after the `terminal` check:

```ts
  if (node.input !== undefined) validateInputMapping(node.input, `${where}.input`);
  if (node.output !== undefined) validateNodeOutputContract(node.output, `${where}.output`);
  if (
    node.effect !== undefined &&
    node.effect !== 'pure' && node.effect !== 'idempotent' && node.effect !== 'side-effecting'
  ) {
    throw new CatalogError(`${where}.effect must be 'pure', 'idempotent', or 'side-effecting' when present`);
  }
```

  - New helpers (module-private):

```ts
function validateInputMapping(value: unknown, where: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogError(`${where} must be an Expression or an object mapping name → Expression`);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.kind === 'string') {
    validateExpression(obj, where);
    return;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    throw new CatalogError(`${where} must declare at least one entry`);
  }
  for (const key of keys) {
    validateExpression(obj[key], `${where}.${key}`);
  }
}

function validateNodeOutputContract(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const o = value as Record<string, unknown>;
  if (o.kind !== 'text' && o.kind !== 'json') {
    throw new CatalogError(`${where}.kind must be 'text' or 'json' (got ${JSON.stringify(o.kind)})`);
  }
  if (o.kind === 'text' && o.schema !== undefined) {
    throw new CatalogError(`${where}.schema is only allowed when kind is 'json'`);
  }
}
```

  - In `validateFlow`: `version` non-empty-string check next to the `id` check.
  - In `validateNodeConfig` `subflow` case: `version` non-empty-string check. In `script` case: the secrets shape check (env name keys non-empty; each value's `credentialId` non-empty string).
  - In `reportUnsupportedFeatures`, inside the per-node loop:

```ts
    const output = node.output as Record<string, unknown> | undefined;
    if (output?.kind === 'json' && output.schema !== undefined) {
      report({
        where: `${at}.output.schema`,
        feature: 'node-output-schema',
        detail: "JSON output is parsed into state.nodes, but the declared schema is not validated against it yet",
      });
    }
    if (node.effect !== undefined) {
      report({
        where: at,
        feature: 'effect',
        detail: 'effect classification is recorded but the runtime does not yet consult it for replay/retry decisions',
      });
    }
    if (node.kind === 'subflow' && (node.config as Record<string, unknown>).version !== undefined) {
      report({
        where: `${at}.config.version`,
        feature: 'subflow-version-pin',
        detail: 'subflows resolve by flowId in the loaded catalog; the version pin is recorded but not enforced',
      });
    }
```

  - Update the `UnsupportedFeature` doc comment's feature-id list.
- [ ] **Step 4: Run to verify pass** (flow-spec suite).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(flow-spec): node input mapping, per-node output contract, effect, flow/subflow version, script secrets"`

### Task 4: Runtime state channels + node I/O wrappers (`input`, `nodes`, structured output parse)

**Files:**
- Modify: `platform/harness/harness-core/src/flow-graph.ts` (FlowState ~line 86; compileFlow ~line 322; new wrappers near `wrapWithTags` ~line 566)
- Modify: `platform/harness/harness-core/src/orchestrator.ts` (`freshFlowState` ~line 702)
- Test: `platform/harness/harness-core/src/flow-graph.test.ts`

**Interfaces:**
- Consumes: `TaskStep.output` / `NodeOutputContract` / `FlowRunState` from Tasks 2–3.
- Produces: FlowState channels `input` (write-once) and `nodes` (merge-reducer); `withNodeIO(step, exec)` wrapper; compile-time `FlowStateT extends FlowRunState` assertion.

- [ ] **Step 1: Write failing tests** in flow-graph.test.ts:

```ts
describe('node-addressable state', () => {
  it('records each node output under state.nodes[id]', async () => {
    const flow: FlowDef = {
      id: 'f', nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'manual' } },
        { id: 'shape', kind: 'transform', config: { expression: { kind: 'literal', value: 'hello' } } },
      ],
      edges: [{ from: 't', to: 'shape', type: 'sequence' }],
    };
    const graph = compileFlow({ flow, executors: new Map() });
    const result = await graph.invoke(fresh('in'), cfg('j1'));
    expect(result.nodes.shape).toBe('hello');
    expect(result.input).toBe('in');
  });
  it('parses declared json output into state.nodes and routes OutputParseError to error edge', async () => {
    const flow: FlowDef = {
      id: 'f', nodes: [
        { id: 't', kind: 'trigger', config: { kind: 'manual' } },
        { id: 'j', kind: 'transform', output: { kind: 'json' }, config: { expression: { kind: 'literal', value: { score: 0.9 } } } },
        { id: 'bad', kind: 'transform', output: { kind: 'json' }, config: { expression: { kind: 'literal', value: 'not json' } } },
        { id: 'handled', kind: 'transform', config: { expression: { kind: 'literal', value: 'recovered' } } },
      ],
      edges: [
        { from: 't', to: 'j', type: 'sequence' },
        { from: 'j', to: 'bad', type: 'sequence' },
        { from: 'bad', to: 'handled', type: 'error' },
      ],
    };
    const graph = compileFlow({ flow, executors: new Map() });
    const result = await graph.invoke(fresh(''), cfg('j2'));
    expect(result.nodes.j).toEqual({ score: 0.9 });
    expect(result.nodes.bad).toBeUndefined();
    expect(result.output).toBe('recovered');
  });
});
```

(`fresh`/`cfg` = local helpers mirroring `freshFlowState` + `{ configurable: { thread_id } }` — copy whatever pattern flow-graph.test.ts already uses for invoking compiled graphs.)

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
  - FlowState — add after `jobId`:

```ts
  /** Job/trigger payload. Write-once: seeded by the initial invoke,
   *  later writes are ignored so nodes can never clobber the flow's
   *  input. jsonpath surface: `$.input`. */
  input: Annotation<unknown>({
    reducer: (current, incoming) => (current === null ? incoming : current),
    default: () => null,
  }),
  /** Per-node outputs, keyed by node id — written by the withNodeIO
   *  wrapper after every successful node that produced output. Merge-
   *  reducer so parallel branches never clobber. jsonpath surface:
   *  `$.nodes.<id>` (structured when the node declares output.kind
   *  'json', the raw output string otherwise). */
  nodes: Annotation<Record<string, unknown>>({
    reducer: (acc, partial) => ({ ...acc, ...partial }),
    default: () => ({}),
  }),
```

  - Compile-time run-state conformance (after `FlowStateT`):

```ts
// Compile-time proof that the runtime state satisfies the spec's
// FlowRunState wire contract. If a channel drifts (name or type), this
// line stops compiling — the honest seam between spec and runtime.
type _RunStateCheck = FlowStateT extends FlowRunState ? true : never;
const _runStateCheck: _RunStateCheck = true;
void _runStateCheck;
```

  - `withNodeIO` (new, near wrapWithTags):

```ts
/**
 * Outermost node wrapper: records the node's output into the
 * `state.nodes` map (after Loop aggregation, so a looped node records
 * its aggregate). When the step declares `output.kind: 'json'`, the
 * output string is parsed and the PARSED value is recorded; parse
 * failure converts the exit to errorName 'OutputParseError' so the
 * flow can route around it via an error edge.
 */
function withNodeIO(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  const nodeId = step.id;
  const wantsJson = step.output?.kind === 'json';
  return async (state) => {
    const delta = await exec(state);
    if (delta.output === undefined) return delta;
    if (delta.lastExit && delta.lastExit.kind !== 'success') return delta;
    if (!wantsJson) return { ...delta, nodes: { [nodeId]: delta.output } };
    try {
      return { ...delta, nodes: { [nodeId]: JSON.parse(delta.output) } };
    } catch (err) {
      return {
        ...delta,
        lastExit: {
          nodeId,
          kind: 'error',
          errorName: 'OutputParseError',
          errorMessage: `declared output.kind 'json' but output is not valid JSON: ${(err as Error).message}`,
        },
      };
    }
  };
}
```

  - compileFlow line ~322: `const wrapped = withNodeIO(node, wrapWithTags(node, baseExec));`
  - `freshFlowState` (orchestrator.ts): add `input, nodes: {}` (`input` = the same `input` param already passed for `output`).
- [ ] **Step 4: Run harness-core suite; fix any deep-equality state assertions that now see the two extra channels.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(harness-core): node-addressable state — input + nodes channels, per-node structured output"`

### Task 5: Runtime input mapping

**Files:**
- Modify: `platform/harness/harness-core/src/flow-graph.ts`
- Test: `platform/harness/harness-core/src/flow-graph.test.ts`

**Interfaces:**
- Consumes: `TaskStep.input` (Task 3), `resolveExpressionValue` (flow-spec).
- Produces: `withInputMapping(step, exec)` — innermost wrapper (inside Loop, so a looped node's mapping sees the per-item state where `$.output` is the current item).

- [ ] **Step 1: Write failing test:**

```ts
it('input mapping composes the effective input from state', async () => {
  const seen: string[] = [];
  const executors = new Map<string, NodeExecutor>([
    ['probe', async (state) => { seen.push(state.output); return { lastExit: { nodeId: 'probe', kind: 'success' } }; }],
  ]);
  const flow: FlowDef = {
    id: 'f', nodes: [
      { id: 't', kind: 'trigger', config: { kind: 'manual' } },
      { id: 'shape', kind: 'transform', output: { kind: 'json' }, config: { expression: { kind: 'object', fields: { score: { kind: 'literal', value: 1 } } } } },
      { id: 'probe', kind: 'agent', config: { agent: { id: 'probe', role: 'r', adapter: 'claude-sdk' } },
        input: { task: { kind: 'jsonpath', path: '$.input' }, score: { kind: 'jsonpath', path: '$.nodes.shape.score' } } },
    ],
    edges: [
      { from: 't', to: 'shape', type: 'sequence' },
      { from: 'shape', to: 'probe', type: 'sequence' },
    ],
  };
  const graph = compileFlow({ flow, executors });
  await graph.invoke(fresh('fix the bug'), cfg('j3'));
  expect(JSON.parse(seen[0])).toEqual({ task: 'fix the bug', score: 1 });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement:**

```ts
/**
 * Innermost node wrapper: when the step declares `input`, resolve the
 * mapping against current state and hand the node an effective
 * `state.output` built from it — a single Expression resolves to its
 * value (strings pass through raw), a Record resolves each field and
 * serializes the object as JSON. This is how a node consumes MORE than
 * the previous node's output: `$.input`, `$.nodes.<id>`, rejection
 * payloads, etc. Runs inside the Loop wrapper so a looped node's
 * mapping sees the per-item state ($.output is the current item).
 */
function withInputMapping(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  const mapping = step.input;
  if (mapping === undefined) return exec;
  return async (state) => {
    const resolved = resolveInputMapping(mapping, state);
    const effective =
      typeof resolved === 'string' ? resolved : (JSON.stringify(resolved) ?? '');
    return exec({ ...state, output: effective });
  };
}

function resolveInputMapping(
  mapping: Expression | Readonly<Record<string, Expression>>,
  state: unknown,
): unknown {
  if (typeof (mapping as { kind?: unknown }).kind === 'string') {
    return resolveExpressionValue(mapping as Expression, state);
  }
  const out: Record<string, unknown> = {};
  for (const [k, sub] of Object.entries(mapping as Record<string, Expression>)) {
    out[k] = resolveExpressionValue(sub, state);
  }
  return out;
}
```

Wiring in compileFlow: `const wrapped = withNodeIO(node, wrapWithTags(node, withInputMapping(node, baseExec)));`
- [ ] **Step 4: Run to verify pass** (full harness-core suite).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(harness-core): node input mapping — expression-composed effective input"`

### Task 6: Error-edge matchers

**Files:**
- Modify: `platform/harness/flow-spec/src/types.ts` (`ErrorEdge`)
- Modify: `platform/harness/flow-spec/src/validate.ts` (edge shape + cardinality)
- Modify: `platform/harness/harness-core/src/flow-graph.ts` (`buildRouter` ~line 374)
- Test: flow-spec `validate.test.ts`; harness-core `flow-graph.test.ts`

**Interfaces:**
- Produces: `ErrorEdge.on?: readonly string[]` — names matched against `NodeExit.errorName`. Multiple error edges per source allowed; at most ONE catch-all (no/empty `on`); first declared match wins.

- [ ] **Step 1: Write failing tests.** flow-spec: two named error edges + one catch-all validates; two catch-alls throws `/at most one catch-all/`; `on: [""]` throws. harness-core router test:

```ts
it('routes errors by errorName via on-matchers, catch-all last', () => {
  const edges: Edge[] = [
    { from: 'n', to: 'onTimeout', type: 'error', on: ['Timeout'] },
    { from: 'n', to: 'onAny', type: 'error' },
  ];
  const route = buildRouter('n', edges);
  expect(route(stateWithExit({ nodeId: 'n', kind: 'error', errorName: 'Timeout' }))).toBe('onTimeout');
  expect(route(stateWithExit({ nodeId: 'n', kind: 'error', errorName: 'NetworkError' }))).toBe('onAny');
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** types.ts ErrorEdge gains `on?: readonly string[]` (doc comment per Interfaces). validate.ts: in `validateEdge`, when `type === 'error'` and `on !== undefined`: must be array of non-empty strings. In `validateFlow`, REPLACE the `'error'`-count cardinality rule with a catch-all-count rule:

```ts
    if (edge.type === 'error') {
      const on = edge.on as unknown[] | undefined;
      const isCatchAll = on === undefined || on.length === 0;
      if (isCatchAll) {
        const n = (errorCatchAllBySource.get(edge.from as string) ?? 0) + 1;
        errorCatchAllBySource.set(edge.from as string, n);
        if (n > 1) {
          throw new CatalogError(
            `${edgeWhere}: at most one catch-all 'error' edge (no "on" list) allowed per source node`,
          );
        }
      }
    }
```

(with `const errorCatchAllBySource = new Map<string, number>();` declared beside `outgoingByType`). buildRouter: replace `const err = out.find(...)` with a filter, and the error branch with:

```ts
    if (exit?.kind === 'error') {
      const name = exit.errorName;
      const named = name
        ? errs.find((e) => e.on !== undefined && e.on.length > 0 && e.on.includes(name))
        : undefined;
      const target = named ?? errs.find((e) => e.on === undefined || e.on.length === 0);
      if (target) return target.to;
      throw new Error(
        `unhandled error at node "${nodeId}": ${exit.errorMessage ?? exit.errorName ?? 'unknown'}`,
      );
    }
```

where `const errs = out.filter((e): e is Extract<Edge, { type: 'error' }> => e.type === 'error');`
- [ ] **Step 4: Run both suites to verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(flow-spec,harness-core): typed error routing — ErrorEdge.on matchers against NodeExit.errorName"`

### Task 7: Script secrets via the credential broker

**Files:**
- Modify: `platform/harness/harness-core/src/tool-executor.ts` (export `fetchCredential`, line 475)
- Modify: `platform/harness/harness-core/src/script-executor.ts` (`makeScriptExecutor` gains optional deps)
- Modify: `platform/harness/harness-core/src/orchestrator.ts` (line ~480: pass `{ broker: deps.broker }`)
- Test: `platform/harness/harness-core/src/script-executor.test.ts`

**Interfaces:**
- Consumes: `ScriptConfig.secrets` (Task 3); `CredentialBroker` from `@helmsmith/agent-auth`; `fetchCredential(broker, credentialId): Promise<string>`.
- Produces: `interface ScriptExecutorDeps { broker?: CredentialBroker }`; `makeScriptExecutor(node: TaskStep, deps: ScriptExecutorDeps = {})` (default arg keeps every existing call site + test compiling).

- [ ] **Step 1: Write failing tests** (follow the existing script-executor.test patterns for building a node + invoking):

```ts
it('resolves declared secrets into the child env', async () => {
  const broker = { getCredential: async () => ({ apiKey: 'sk-test' }) } as unknown as CredentialBroker;
  const node = scriptNode({ language: 'bash', source: 'printf "%s" "$API_KEY"', secrets: { API_KEY: { credentialId: 'anthropic' } } });
  const exec = makeScriptExecutor(node, { broker });
  const delta = await exec(freshState(''));
  expect(delta.output).toBe('sk-test');
});
it('errors with AuthError when secrets are declared but no broker is wired', async () => {
  const node = scriptNode({ language: 'bash', source: 'true', secrets: { API_KEY: { credentialId: 'anthropic' } } });
  const delta = await makeScriptExecutor(node)(freshState(''));
  expect(delta.lastExit).toMatchObject({ kind: 'error', errorName: 'AuthError' });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** Export `fetchCredential` from tool-executor.ts (add `export` keyword). In script-executor.ts: read the full file first; add at the top of the returned executor, before spawning:

```ts
    const secretEnv: Record<string, string> = {};
    const secrets = config.secrets;
    if (secrets && Object.keys(secrets).length > 0) {
      if (!deps.broker) {
        return {
          lastExit: {
            nodeId, kind: 'error', errorName: 'AuthError',
            errorMessage: `script declares secrets but no credential broker is configured`,
          },
        };
      }
      for (const [envName, ref] of Object.entries(secrets)) {
        try {
          secretEnv[envName] = await fetchCredential(deps.broker, ref.credentialId);
        } catch (err) {
          return {
            lastExit: {
              nodeId, kind: 'error', errorName: 'AuthError',
              errorMessage: `failed to resolve secret ${envName}: ${(err as Error).message}`,
            },
          };
        }
      }
    }
```

and merge `...secretEnv` into the child env AFTER `config.env` (secrets win over static env; comment why: a catalog's static env must not shadow a resolved credential). Orchestrator: `executors.set(node.id, makeScriptExecutor(node, { broker: deps.broker }));`
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(harness-core): script secrets resolved through the credential broker"`

### Task 8: Conformance, coverage matrix, full verification

**Files:**
- Modify: `platform/harness/harness-core/src/flow-spec-conformance.test.ts` (replay `expectedValue`)
- Modify: `platform/harness/harness-core/src/orchestrator.ts` (RUNTIME COVERAGE MATRIX comment, ~line 309)
- Modify: `platform/harness/flow-spec/src/types.ts` (header comment) if it still says array indexing unsupported anywhere

**Steps:**
- [ ] **Step 1:** In the conformance test, alongside the existing `evalExpression` replay, add: for cases with `expectedValue !== undefined`, assert `resolveExpressionValue(c.expr, c.state)` deep-equals it.
- [ ] **Step 2:** Update the coverage matrix: expressions section gains `exists / object / array / string compare ops ✅`; add rows for `input mapping ✅ (withInputMapping)`, `node outputs → state.nodes ✅ (withNodeIO)`, `output.kind json parse ✅ / schema ❌ (reported)`, `error-edge on matchers ✅`, `script secrets ✅`, `effect ❌ (reported)`, `subflow version pin ❌ (reported)`.
- [ ] **Step 3:** Full verification: `cd platform/harness/flow-spec && npx vitest run && npx tsc --noEmit; cd ../harness-core && npx vitest run && npx tsc --noEmit`. Also run harness-server's suite if it imports moved types: `grep -rn "ApprovalRequest\|ChangedFile\|NodeExit" ../harness-server/src | head` — if hits exist, `cd ../harness-server && npx vitest run`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "test(harness-core): conformance replays expectedValue; coverage matrix updated"`

### Task 9: Documentation

**Files:**
- Modify: `platform/harness/flow-spec/SPEC.md` (§3 gains a "State model" subsection + expression table rows + node I/O + error matchers + effect/version/secrets; §5 feature list gains `node-output-schema`, `effect`, `subflow-version-pin`; §6 notes `expectedValue`)
- Modify: `platform/harness/flow-spec/docs/steps-and-edges.md` (read first; add the new fields where each step/edge is documented)
- Modify: `platform/harness/flow-spec/docs/critical-feedback.md` (move newly-fixed items into §1 with resolutions; add the data-plane critique record: single-string channel → resolved by `input`/`nodes`; per-node output contract → resolved; input mapping → resolved; error matchers → resolved; expression gaps → resolved; remaining: schema enforcement, effect enforcement, run-event stream, HITL role check)
- Modify: `platform/harness/flow-spec/docs/next-steps.md` (strike 0.3; note 2.4's state-model prerequisite now exists; add "enforce output schema" / "consult effect on replay" as new Phase-2 rows)
- Modify: `platform/harness/flow-spec/README.md` (one paragraph: the data-plane contract exists; `$.input` / `$.nodes.<id>`)

**Steps:**
- [ ] **Step 1:** Update each doc per above. Keep the docs' existing voice (severity emoji, tables, "current truth" phrasing). Every claim must match what the code now does — re-check any statement against the implementation before writing it.
- [ ] **Step 2:** Fix the now-true doc examples: `types.ts:585`'s `$.input.repos` jsonpath example is now real — note it; the `js`-kind example comment stays (still throws).
- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs(flow-spec): data-plane contract — state model, node I/O, error matchers, honest status updates"`

## Phase 2 — hardening follow-up (post-merge review findings, branch `feat/flow-spec-hardening`)

### Task 10: Loop + `output.kind: 'json'` aggregates a JSON array

The `\n---\n` join is never valid JSON, so json-declaring looped nodes fail on >1 item. Fix: when the step declares json output, the loop aggregates `[item1,item2,…]` (each item must itself be JSON — a non-JSON item then fails the array parse, which is the correct semantic). `withNodeIO` parses the array normally → `$.nodes.<id>` = array of per-iteration values.

- Modify `flow-graph.ts`: thread a `joinOutputs` fn from `wrapWithTags(step, …)` (which sees `step.output`) into `loopWrapper`/`runLoopSequential`/`runLoopParallel`: `wantsJson ? '[' + outputs.join(',') + ']' : outputs.join('\n---\n')`.
- Tests (flow-graph.test.ts): looped transform with `output:{kind:'json'}` over 2 items → `result.nodes.each` deep-equals the 2-element array; non-JSON item → `OutputParseError`.
- Docs: `NodeOutputContract` comment + steps-and-edges §5 row.

### Task 11: Terminal flow-output enforcement (roadmap 2.5)

New browser-safe module `flow-spec/src/output.ts`: `parseFlowOutput(contract, text)` → `{ok:true, value} | {ok:false, error}`; kinds: `agent-text` (pass-through), `job-intent` (JSON parse + shape: flowId/productId non-empty strings, `input` present), `job-intents` (array of shapes + min/max), `flow-spec` (JSON parse + `validateFlowCatalog({flows:[parsed]})`), `structured` (JSON parse only — schema NOT enforced, new load-time report `flow-output-schema`). Runtime: `finalizeOrPause` gains the flow's output contract; before promoting to 'completed', run `parseFlowOutput`; failure → status 'failed' + bus error `FlowOutputError`. Tests in both packages.

### Task 12: Phase 1.1 — validation + unsupported fixtures as data

`fixtures.ts` gains `VALIDATION_CASES` (`{name, catalog, valid, errorIncludes?}`) and `UNSUPPORTED_CASES` (`{name, flow, expectedFeatures}` — exact sorted-set match so both false-warns AND missing-warns fail). Replayed by `fixtures.test.ts` and harness-core's conformance test (via its re-exported validator). One case must exercise every current report id incl. `flow-output-schema`; one all-executed-features case must expect `[]`.

### Task 13: Script state view honesty

`serializableStateView` gains `input` (job payload — small); `nodes` stays excluded (env-size) but the return type becomes `Omit<FlowRunState, 'messages' | 'changedFiles' | 'nodes'>` so FlowRunState growth forces an explicit include/exclude decision here. Fix the "full state" doc claims (script-executor header, steps-and-edges §2.4): scripts reach node outputs via `input` mappings (stdin), not the env var.

### Task 14: Docs

Fold the post-merge review findings into `critical-feedback.md` (loop+json 🔴 → resolved here; script-view drift → resolved; tool-args-vs-input overlap, stringly delivery, `kind`-key wart, `nodes` growth → recorded open); update SPEC/steps-and-edges/README/next-steps for Tasks 10–13 (2.5 done, 1.1 done).

## Self-Review Notes

- Spec coverage: Tier 1.1 → Tasks 2+4; 1.2 → Tasks 3+4; 1.3 → Tasks 3+5; Tier 2.4 → Task 6; 2.5 → Task 1; Tier 3.6 → Task 3 (declared + reported; enforcement is future); 3.7 → Task 2; 3.8 → Task 3 (identity + reported pin); 3.9 → Tasks 3+7; docs → Task 9. ✓
- Type consistency: `NodeOutputContract` (Tasks 3,4), `withNodeIO`/`withInputMapping` (Tasks 4,5), `ErrorEdge.on` (Task 6), `ScriptExecutorDeps` (Task 7), `FlowRunState` (Tasks 2,4). ✓
- Known risk: LangGraph channel seeding through reducers — the write-once `input` reducer assumes initial `invoke(values)` passes through reducers with `current === null` default. Task 4 Step 1's test asserts `result.input === 'in'`, which proves it either way; if it fails, switch to last-write-wins `(_, n) => n` + convention comment.
- Known risk: deep-equal assertions on full state in existing tests break on the two new channels — Task 4 Step 4 budgets for that.
