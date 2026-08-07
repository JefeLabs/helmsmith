# @helmsmith/flow-spec Package Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the flow spec (types + validation + expression semantics + conformance fixtures) from `@helmsmith/harness-core` into a browser-safe `@helmsmith/flow-spec` package, with zero churn for external consumers.

**Architecture:** New package at `platform/harness/flow-spec/` holds the pure spec: `types.ts` (wire types + tiny helpers), `validate.ts` (validators + a new unsupported-feature reporting seam), `expression.ts` (evaluator retyped against structural `unknown` state), `fixtures.ts` (conformance cases). `harness-core/src/catalog.ts` shrinks to `loadCatalog` (Node fs) + wildcard re-export; `flow-graph.ts` re-exports the evaluator it used to define. All existing harness-core/harness-server/CLI imports keep working unchanged — the existing 232-test suite doubles as the compatibility proof.

**Tech Stack:** TypeScript 5.6 (source-shipped packages, no build), pnpm 9 workspaces, vitest (root config, default include globs), biome.

## Global Constraints

- Package layout mirrors `platform/core/agent-auth-lib`: `"private": true`, `"type": "module"`, `"main": "src/index.ts"`, `"exports": { ".": "./src/index.ts" }`, `"scripts": { "typecheck": "tsc --noEmit" }`.
- `@helmsmith/flow-spec` must have **zero `node:*` imports** and zero runtime dependencies (browser-safe). `loadCatalog` (uses `node:fs`) stays in harness-core.
- Dependency direction: harness-core → flow-spec, never the reverse.
- No changes to `harness-core/src/index.ts` and no changes to any file outside `platform/harness/flow-spec/` and `platform/harness/harness-core/src/{catalog.ts,flow-graph.ts}` + `harness-core/package.json` + the one new conformance test file.
- Moved code is moved **verbatim** (comments included) unless a task says otherwise.
- All work on branch `feat/flow-spec-package`. Run `pnpm exec biome check --write <files>` before each commit.
- Verify commands run from repo root: `pnpm exec vitest run platform/harness/flow-spec`, `pnpm exec vitest run platform/harness/harness-core`, `pnpm -r typecheck`.

---

### Task 1: Scaffold package + move spec types

**Files:**
- Create: `platform/harness/flow-spec/package.json`
- Create: `platform/harness/flow-spec/tsconfig.json`
- Create: `platform/harness/flow-spec/src/types.ts`
- Create: `platform/harness/flow-spec/src/index.ts`

**Interfaces:**
- Produces: `@helmsmith/flow-spec` exporting every spec type currently in `catalog.ts` plus `CatalogError`, `walkAgents`, `findFlow`, `findProduct`, `resolveAccepts`.

- [ ] **Step 1: Create branch**

```bash
git checkout -b feat/flow-spec-package
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "@helmsmith/flow-spec",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "extends": "../../../tsconfig.base.json",
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create src/types.ts** — move (verbatim, with doc comments) these symbols from `harness-core/src/catalog.ts`: `AdapterId`, `AgentDef`, the flow-taxonomy comment block, `TaskStep`, `AgentConfig`, `ToolConfig`, `ToolDef`, `CliToolDef`, `HttpToolDef`, `McpToolDef`, `ToolAuthRef`, `ToolResolver`, `ScriptConfig`, `TransformConfig`, `GateConfig`, `Assertion`, `SubflowConfig`, `TriggerConfig`, `PublishConfig`, `PushAndOpenPrConfig`, `MergePrConfig`, `TaskStepTags`, `ApprovalTag`, `SteeringInputSchema`, `SuspendTag`, `LoopTag`, `TaskStepPolicy`, `RetryPolicy`, `BackoffPolicy`, `Duration`, `Edge`, `SequenceEdge`, `ConditionalEdge`, `FallbackEdge`, `ErrorEdge`, `RejectEdge`, `RejectionPayload`, `CompareOp`, `Expression`, `FlowOutputContract`, `JobIntent`, `FlowDef`, `walkAgents`, `ContextSourceDef`, `ProductRepo`, `ProductDef`, `FlowCatalog`, `Catalog`, `CatalogError`, `resolveAccepts`, `findFlow`, `findProduct`. Update the stale header pointer while moving: the two comments citing `.plans/flow-designer-spec-v1.0.md` become `docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`. Do NOT move `loadCatalog`, `EMPTY`, or any `validate*` function yet. Do NOT delete anything from catalog.ts yet (transient duplication until Task 4).

- [ ] **Step 5: Create src/index.ts**

```typescript
export * from './types.ts';
```

- [ ] **Step 6: Verify typecheck + workspace resolution**

Run: `pnpm install && pnpm --filter @helmsmith/flow-spec typecheck`
Expected: install links the new package; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add platform/harness/flow-spec pnpm-lock.yaml
git commit -m "feat(flow-spec): scaffold @helmsmith/flow-spec with spec types"
```

---

### Task 2: Move validators

**Files:**
- Create: `platform/harness/flow-spec/src/validate.ts`
- Modify: `platform/harness/flow-spec/src/index.ts`
- Test: `platform/harness/flow-spec/src/validate.test.ts`

**Interfaces:**
- Consumes: types from `./types.ts`.
- Produces: `validateFlowCatalog(value: unknown, path: string, opts?: ValidateOptions): asserts value is FlowCatalog`, `validateUnifiedCatalog(value: unknown, path: string, opts?: ValidateOptions): asserts value is Catalog` (the `opts` param is added in Task 4; signatures here ship without it and Task 4 extends them).

- [ ] **Step 1: Write the failing test** (`validate.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { CatalogError, validateFlowCatalog } from './index.ts';

const validFlow = {
  id: 'demo',
  nodes: [
    { id: 't', kind: 'trigger', config: { kind: 'manual' } },
    { id: 'g', kind: 'gate', config: { assertions: [{ expression: { kind: 'literal', value: true }, message: 'ok' }] } },
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
      flows: [{
        ...validFlow,
        edges: [
          { from: 't', to: 'g', type: 'sequence' },
          { from: 'g', to: 'g', type: 'sequence' },
        ],
      }],
    };
    expect(() => validateFlowCatalog(cyclic, 'test')).toThrow(/cycle detected/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run platform/harness/flow-spec`
Expected: FAIL — `validateFlowCatalog` is not exported.

- [ ] **Step 3: Create validate.ts** — move (verbatim) from `harness-core/src/catalog.ts`: `validateFlowCatalog`, `validateFlow`, `hasCycle`, `dfsCycle`, `validateAgentDef`, `VALID_NODE_KINDS`, `VALID_PUBLISH_ACTIONS`, `validateNode`, `validateNodeConfig`, `validatePublishConfig`, `validateTriggerConfig`, `validateTaskStepTags`, `validateApprovalTag`, `validateSuspendTag`, `validateLoopTag`, `validateTaskStepPolicy`, `validateJoinStrategy`, `VALID_COMPARE_OPS`, `validateExpression`, `validateEdge`, `validateFlowOutputContract`, `validateSkillzField`, `VALID_FALLBACK_ERROR_NAMES`, `validateFallbackOnField`, `validateAcceptsField`, `validateAcceptsList`, `validateUnifiedCatalog`. Imports come from `./types.ts`. Export `validateFlowCatalog` and `validateUnifiedCatalog` (the rest stay module-private, as today).

- [ ] **Step 4: Extend index.ts**

```typescript
export * from './types.ts';
export * from './validate.ts';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run platform/harness/flow-spec && pnpm --filter @helmsmith/flow-spec typecheck`
Expected: 3 tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add platform/harness/flow-spec
git commit -m "feat(flow-spec): move catalog validators into flow-spec"
```

---

### Task 3: Extract expression evaluator with structural state

**Files:**
- Create: `platform/harness/flow-spec/src/expression.ts`
- Modify: `platform/harness/flow-spec/src/index.ts`
- Test: `platform/harness/flow-spec/src/expression.test.ts`

**Interfaces:**
- Produces: `evalExpression(expr: Expression, state: unknown): boolean`, `resolveExpressionValue(expr: Expression, state: unknown): unknown`, `resolveJsonPath(path: string, state: unknown): unknown`. The `unknown` state type is the point — flow-graph's `FlowStateT` is assignable to it, and a browser designer can pass plain objects.

- [ ] **Step 1: Write the failing test** (`expression.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { evalExpression, resolveExpressionValue } from './index.ts';

describe('evalExpression', () => {
  const state = { output: 'hello', review: { score: 0.9 }, repos: ['a', 'b'] };

  it('jsonpath resolves dot paths against arbitrary state', () => {
    expect(evalExpression({ kind: 'jsonpath', path: '$.review.score' }, state)).toBe(true);
    expect(evalExpression({ kind: 'jsonpath', path: '$.missing.deep' }, state)).toBe(false);
  });

  it('compare: NaN on either side of a numeric op is false', () => {
    expect(evalExpression({ kind: 'compare', lhs: { kind: 'literal', value: 'x' }, op: '<', rhs: { kind: 'literal', value: 5 } }, state)).toBe(false);
  });

  it('in requires an array rhs', () => {
    expect(evalExpression({ kind: 'compare', lhs: { kind: 'literal', value: 'a' }, op: 'in', rhs: { kind: 'jsonpath', path: '$.repos' } }, state)).toBe(true);
    expect(evalExpression({ kind: 'compare', lhs: { kind: 'literal', value: 'ell' }, op: 'in', rhs: { kind: 'jsonpath', path: '$.output' } }, state)).toBe(false);
  });

  it('vacuous identities: all([]) true, any([]) false', () => {
    expect(evalExpression({ kind: 'all', exprs: [] }, state)).toBe(true);
    expect(evalExpression({ kind: 'any', exprs: [] }, state)).toBe(false);
  });

  it('js throws', () => {
    expect(() => evalExpression({ kind: 'js', expression: '1' }, state)).toThrow(/not yet supported/);
  });

  it('resolveExpressionValue returns raw values, booleans for compositions', () => {
    expect(resolveExpressionValue({ kind: 'jsonpath', path: '$.review.score' }, state)).toBe(0.9);
    expect(resolveExpressionValue({ kind: 'not', expr: { kind: 'literal', value: false } }, state)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run platform/harness/flow-spec`
Expected: FAIL — `evalExpression` not exported.

- [ ] **Step 3: Create expression.ts** — move from `harness-core/src/flow-graph.ts` (verbatim including doc comments): `evalExpression`, `evalCompare` (stays private), `resolveJsonPath` (becomes exported), `resolveExpressionValue` (becomes exported). Replace every `FlowStateT` parameter type with `unknown` and the `import('./catalog.ts').CompareOp` inline type with a normal `CompareOp` import from `./types.ts`. No logic changes — `resolveJsonPath` already traverses `unknown`.

- [ ] **Step 4: Extend index.ts**

```typescript
export * from './types.ts';
export * from './validate.ts';
export * from './expression.ts';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run platform/harness/flow-spec && pnpm --filter @helmsmith/flow-spec typecheck`
Expected: all flow-spec tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add platform/harness/flow-spec
git commit -m "feat(flow-spec): extract expression evaluator with structural state type"
```

---

### Task 4: Conformance fixtures + unsupported-feature reporting

**Files:**
- Create: `platform/harness/flow-spec/src/fixtures.ts`
- Modify: `platform/harness/flow-spec/src/validate.ts`
- Modify: `platform/harness/flow-spec/src/index.ts`
- Test: `platform/harness/flow-spec/src/fixtures.test.ts`, additions to `validate.test.ts`

**Interfaces:**
- Produces: `EXPRESSION_CASES: readonly ExpressionCase[]` where `ExpressionCase = { name: string; expr: Expression; state: unknown; expected: boolean }`; `UnsupportedFeature = { where: string; feature: string; detail: string }`; `ValidateOptions = { onUnsupported?: (f: UnsupportedFeature) => void }` accepted by both public validators.

- [ ] **Step 1: Write the failing fixtures test** (`fixtures.test.ts`)

```typescript
import { describe, expect, it } from 'vitest';
import { EXPRESSION_CASES, evalExpression } from './index.ts';

describe('conformance fixtures', () => {
  it('ships at least 10 expression cases', () => {
    expect(EXPRESSION_CASES.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of EXPRESSION_CASES) {
    it(`expression: ${c.name}`, () => {
      expect(evalExpression(c.expr, c.state)).toBe(c.expected);
    });
  }
});
```

- [ ] **Step 2: Write the failing unsupported-feature test** (append to `validate.test.ts`)

```typescript
import type { UnsupportedFeature } from './index.ts';

describe('unsupported-feature reporting', () => {
  it('reports policy, joinStrategy, terminal, non-manual triggers, js expressions, and extra sequence edges', () => {
    const reported: UnsupportedFeature[] = [];
    const catalog = {
      flows: [{
        id: 'demo',
        nodes: [
          { id: 't', kind: 'trigger', config: { kind: 'schedule', cron: '0 * * * *' } },
          { id: 'a', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } }, policy: { retry: { maxAttempts: 3 } }, joinStrategy: 'any' },
          { id: 'b', kind: 'transform', config: { expression: { kind: 'literal', value: 1 } }, terminal: 'fail' },
          { id: 'c', kind: 'gate', config: { assertions: [{ expression: { kind: 'js', expression: 'true' }, message: 'x' }] } },
        ],
        edges: [
          { from: 't', to: 'a', type: 'sequence' },
          { from: 'a', to: 'b', type: 'sequence' },
          { from: 'a', to: 'c', type: 'sequence' },
        ],
      }],
    };
    validateFlowCatalog(catalog, 'test', { onUnsupported: (f) => reported.push(f) });
    const features = reported.map((f) => f.feature).sort();
    expect(features).toEqual(['expression-js', 'joinStrategy', 'parallel-fan-out', 'policy', 'terminal-fail', 'trigger-schedule']);
  });

  it('reports nothing for a fully-supported flow and stays silent without a callback', () => {
    const reported: UnsupportedFeature[] = [];
    const ok = { flows: [{ id: 'd', nodes: [{ id: 't', kind: 'trigger', config: { kind: 'manual' } }, { id: 'g', kind: 'gate', config: { assertions: [{ expression: { kind: 'literal', value: true }, message: 'ok' }] } }], edges: [{ from: 't', to: 'g', type: 'sequence' }] }] };
    validateFlowCatalog(ok, 'test', { onUnsupported: (f) => reported.push(f) });
    expect(reported).toEqual([]);
    expect(() => validateFlowCatalog(ok, 'test')).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run platform/harness/flow-spec`
Expected: FAIL — `EXPRESSION_CASES` / `UnsupportedFeature` not exported; `validateFlowCatalog` rejects a third argument.

- [ ] **Step 4: Create fixtures.ts** — `ExpressionCase` type + `EXPRESSION_CASES` with ≥10 cases covering: literal truthy/falsy, jsonpath hit/miss/root `$`, compare `==` strict (no coercion), compare numeric with string-number coercion, compare NaN⇒false, `in` membership hit, `in` non-array rhs ⇒ false, `all`/`any` vacuous identities, `not` inversion, nested `all(compare, not(any))` composition. Each case is data, not code — the same file a designer UI or the Java side can consume later.

- [ ] **Step 5: Implement reporting in validate.ts** — add the types and thread `opts` through `validateFlowCatalog` / `validateUnifiedCatalog` → `validateFlow` (and into `validateExpression` for `js`). Emission points, with `where` reusing the validator's existing path strings and `detail` naming the runtime truth:
  - `validateNode`: `node.policy` present → feature `policy`; `node.joinStrategy` present → `joinStrategy`; `node.terminal === 'fail'` → `terminal-fail`.
  - `validateTriggerConfig`: `kind !== 'manual'` → `trigger-<kind>`.
  - `validateExpression`: `kind === 'js'` → `expression-js`.
  - `validateFlow` edge pass: second+ `sequence` edge from one source → `parallel-fan-out` (report once per source node).
  Reporting never throws and never changes accept/reject behavior — omitted callback ≡ today's semantics.

- [ ] **Step 6: Extend index.ts**

```typescript
export * from './types.ts';
export * from './validate.ts';
export * from './expression.ts';
export * from './fixtures.ts';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm exec vitest run platform/harness/flow-spec && pnpm --filter @helmsmith/flow-spec typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add platform/harness/flow-spec
git commit -m "feat(flow-spec): conformance fixtures + unsupported-feature reporting seam"
```

---

### Task 5: Flip harness-core to consume flow-spec

**Files:**
- Modify: `platform/harness/harness-core/package.json` (add `"@helmsmith/flow-spec": "workspace:*"` to dependencies)
- Modify: `platform/harness/harness-core/src/catalog.ts`
- Modify: `platform/harness/harness-core/src/flow-graph.ts`
- Test: `platform/harness/harness-core/src/flow-spec-conformance.test.ts` (create)

**Interfaces:**
- Consumes: everything Task 1–4 produced.
- Produces: unchanged public surface of `@helmsmith/harness-core` — this task's definition of done is the existing suite passing untouched.

- [ ] **Step 1: Write the failing conformance test** (`flow-spec-conformance.test.ts`)

```typescript
import { EXPRESSION_CASES } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { evalExpression } from './flow-graph.ts';

// The runtime must implement spec expression semantics exactly — the
// fixture set is the contract a designer UI previews against.
describe('runtime conforms to flow-spec expression fixtures', () => {
  for (const c of EXPRESSION_CASES) {
    it(c.name, () => {
      expect(evalExpression(c.expr, c.state as never)).toBe(c.expected);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run platform/harness/harness-core/src/flow-spec-conformance.test.ts`
Expected: FAIL — `@helmsmith/flow-spec` not a dependency of harness-core yet.

- [ ] **Step 3: Add the dependency and install**

Add to `harness-core/package.json` dependencies: `"@helmsmith/flow-spec": "workspace:*"`, then run `pnpm install`.

- [ ] **Step 4: Rewrite catalog.ts** to keep only the Node-side loader, re-exporting the spec (header comment updated: canonical spec now lives in flow-spec; catalog file path is `flows.json` — fixing the stale `pipelines.json` reference). Final file shape:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CatalogError,
  type FlowCatalog,
  type UnsupportedFeature,
  validateFlowCatalog,
} from '@helmsmith/flow-spec';

/**
 * Node-side catalog loading for the harness runtime. The spec itself —
 * types, validation, expression semantics, conformance fixtures — lives
 * in @helmsmith/flow-spec (browser-safe, zero deps) and is re-exported
 * here so existing `./catalog.ts` imports keep working.
 *
 * Local layout: `.harness/config/flows.json` at the workspace root.
 * Production sources the same shape from controlplane over HTTP —
 * `loadCatalog()` is the local-fs path; the controlplane-fed path lives
 * in harness-server's `load-catalog.ts`.
 */
export * from '@helmsmith/flow-spec';

const EMPTY: FlowCatalog = { flows: [] };

/** One console.warn line per spec feature the runtime does not execute
 *  yet — policy, joinStrategy, terminal:'fail', non-manual triggers,
 *  js expressions, parallel fan-out. Loud at load time so catalog
 *  authors learn before a silent no-op ships. */
function warnUnsupported(path: string, f: UnsupportedFeature): void {
  console.warn(`[catalog] ${path}: ${f.where}: "${f.feature}" is not executed by the runtime yet — ${f.detail}`);
}

export async function loadCatalog(workspaceRoot: string): Promise<FlowCatalog> {
  const path = join(workspaceRoot, '.harness', 'config', 'flows.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw new CatalogError(`failed to read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CatalogError(`${path}: invalid JSON — ${(err as Error).message}`);
  }

  validateFlowCatalog(parsed, path, { onUnsupported: (f) => warnUnsupported(path, f) });
  return parsed as FlowCatalog;
}
```

Everything else in the current catalog.ts (all types, all validators, `walkAgents`, `resolveAccepts`, `findFlow`, `findProduct`, `CatalogError`) is deleted — the wildcard re-export supplies them. Keep the original `loadCatalog` doc comment about missing-file / fail-loud semantics.

- [ ] **Step 5: Rewire flow-graph.ts** — delete the moved implementations (`evalExpression`, `evalCompare`, `resolveJsonPath`, `resolveExpressionValue`) and at the top of the file add:

```typescript
import { evalExpression, resolveExpressionValue } from '@helmsmith/flow-spec';
export { evalExpression };
```

Call sites inside flow-graph.ts (`buildRouter`, gate/transform executors, `loopWrapper`, `resolveLoopItems`) keep their exact call shapes — `FlowStateT` narrows to `unknown` implicitly. `tool-executor.ts` / `subflow-executor.ts` / `index.ts` import `evalExpression` from `./flow-graph.ts` today and continue to, via the re-export.

- [ ] **Step 6: Run the full compatibility proof**

Run: `pnpm exec biome check --write platform/harness/flow-spec platform/harness/harness-core/src && pnpm exec vitest run platform/harness/harness-core platform/harness/flow-spec && pnpm -r typecheck`
Expected: all 232 existing harness-core tests + the new conformance test + all flow-spec tests PASS; every package typechecks. If any existing test fails, the re-export surface is wrong — fix catalog.ts/flow-graph.ts, never the test.

- [ ] **Step 7: Run harness-server + CLI suites (external-consumer proof)**

Run: `pnpm exec vitest run platform/harness/harness-server platform/harness/harness-cli platform/harness/harness-pipeline-cli`
Expected: PASS (these import `@helmsmith/harness-core`, whose surface is unchanged).

- [ ] **Step 8: Commit**

```bash
git add platform/harness/harness-core pnpm-lock.yaml
git commit -m "refactor(harness-core): consume @helmsmith/flow-spec; catalog.ts keeps only loadCatalog"
```

---

### Task 6: Package README + review-doc cross-link

**Files:**
- Create: `platform/harness/flow-spec/README.md`
- Modify: `docs/superpowers/specs/2026-08-07-flow-spec-design-review.md` (§7 recommendation status only)

- [ ] **Step 1: Write README.md** covering: what the package is (the flow spec: types + validation + expression semantics + conformance fixtures), the browser-safe/zero-deps constraint, the dependency direction rule (harness-core → flow-spec), what deliberately stays out (`loadCatalog`, compilation, executors), the `onUnsupported` contract with the current feature list, and how conformance fixtures are consumed by harness-core's `flow-spec-conformance.test.ts`.

- [ ] **Step 2: Update the review doc** — in §7, mark recommendation 1 (validator honesty) as done via `onUnsupported` + `loadCatalog` warnings, and note under recommendation 10 that `@helmsmith/flow-spec` is now the home for future JSON Schema generation.

- [ ] **Step 3: Commit**

```bash
git add platform/harness/flow-spec/README.md docs/superpowers/specs/2026-08-07-flow-spec-design-review.md docs/superpowers/plans/2026-08-07-flow-spec-package.md
git commit -m "docs(flow-spec): package README + review-doc status update"
```
