# HELM-T1: taskmaster — restore typecheck + tests

**Labels:** `bug` · `area:taskmaster` · `toolbox-backlog`
**Status:** ✅ RESOLVED
**CI exclusion:** removed (taskmaster runs in both CI steps again)
**Verified (Node 22):** `typecheck` exit 0; `test` 77 files / 1199 tests pass; green under the parallel CI run.

## Resolution

Fixed in branch `fix/helm-t1-taskmaster`. The failures were a stack of independent
pre-existing issues, fixed in order:
1. **Phantom dep + JSX:** added `@opentui/core`/`@opentui/react` deps and
   `jsx`/`jsxImportSource` to tsconfig → cleared 50 `TS6142`.
2. **Zod v4:** `.default({})` → `.prefault({})` on object schemas (config/schema.ts,
   blueprints/types.ts).
3. **Missing required fields:** added `qaFeedback: []` (3 TaskNode constructions)
   and `entryPointIds: []` (6 component constructions); `ParsedSection` import;
   `string|null` username widened to `string|undefined`; cast-through-`unknown` in
   sync.ts.
4. **react-reconciler crash:** `@opentui/react@0.2.16` emits an extensionless ESM
   import of `react-reconciler/constants` that crashes at load. Made the TUI
   (`connect`) a lazy `import()` and turned on tsup `splitting` so non-interactive
   commands never pull the reconciler into the startup graph. *(The upstream
   @opentui/react ESM bug still affects the interactive `connect` TUI — see HELM-T5.)*
5. **init hang / init-wizard unit test (same root cause):** `init --no-interactive`
   blocked on the agent-instruction-files prompt. Gated that step behind a new
   `interactive` wizard-context flag (default false); init passes
   `interactive: opts.interactive !== false`.

---

_Original report below._

**Repro (Node 22):** `pnpm --filter @ecruz165/taskmaster run typecheck` · `... run test`

## Summary

`taskmaster` fails both typecheck and its test suite (`5 failed | 72 passed`).
Three independent pre-existing issues; none caused by the merge.

## Symptoms

**Tests**
- e2e (`crud-commands`, `error-scenarios`, `lifecycle`, `multi-project`): built
  `dist/cli.js` aborts with `ERR_MODULE_NOT_FOUND: Cannot find package
  '@opentui/react'`; once that's resolved, `Cannot find module
  'react-reconciler/constants'` from `@opentui/react@0.2.16`.
- unit (`tests/unit/prompts/init-wizard.test.ts`): `expected "vi.fn()" to not be
  called at all, but actually been called 1 times`.

**Typecheck**
- zod-v4 `No overload matches this call` (`src/blueprints/types.ts`, `src/config/schema.ts`).
- `Property 'qaFeedback' is missing … required in 'TaskNode'` (`src/commands/add.ts`,
  `src/decomposer/expander.ts`, `src/parser/task-generator.ts`).
- `Cannot find name 'ParsedSection'` (`src/parser/index.ts`).
- `'--jsx' is not set` for `tui-view-components` `.tsx` imported as source.

## Root cause

1. **Phantom dep:** taskmaster uses `tui-view-components` (→ `@opentui/react`) but
   doesn't declare `@opentui/core`/`@opentui/react`, unlike every sibling that does.
   Declaring them exposes a second layer: `@opentui/react@0.2.16` can't resolve
   `react-reconciler/constants` at runtime.
2. **App-code type errors** (zod v4, missing `qaFeedback`, missing `ParsedSection`).
3. **Unit test** asserts a mock isn't called, but it is.

## Acceptance criteria

- [ ] Declare `@opentui/core` + `@opentui/react` (`^0.2.2`) and resolve the
      `react-reconciler/constants` runtime error (likely a react-reconciler pin).
- [ ] Fix zod-v4 schema typings; add/relax `qaFeedback` on `TaskNode`; import or
      define `ParsedSection`; set `jsx` for the `tui-view-components` source imports.
- [ ] Fix the `init-wizard` mock expectation.
- [ ] `pnpm --filter @ecruz165/taskmaster run typecheck` and `... run test` exit 0
      on Node 22.
- [ ] Remove the taskmaster typecheck + test exclusions from `ci.yml`.
