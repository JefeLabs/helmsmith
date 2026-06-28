# HELM-T1: taskmaster — restore typecheck + tests

**Labels:** `bug` · `area:taskmaster` · `ci-excluded` · `toolbox-backlog`
**Status:** Open
**CI exclusion:** typecheck **and** test (`.github/workflows/ci.yml`) — remove both on close
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
