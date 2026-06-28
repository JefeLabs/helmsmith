# HELM-T1 — taskmaster: restore typecheck + tests

- **Status:** Open
- **Package:** `apps/taskmaster`
- **Kind:** typecheck + tests (pre-existing app debt)
- **CI:** excluded from BOTH typecheck and test in `.github/workflows/ci.yml`.
  Remove both exclusions when this closes.
- **Verify locally:** `nvm use 22 && pnpm --filter @ecruz165/taskmaster run typecheck`
  and `... run test`

## Symptoms

**Tests** — `5 failed | 72 passed (77 files)`:
- *e2e (crud-commands, error-scenarios, lifecycle, multi-project):* the built
  `dist/cli.js` aborts with
  `ERR_MODULE_NOT_FOUND: Cannot find package '@opentui/react'`, and after that is
  resolved, `Cannot find module 'react-reconciler/constants'` from
  `@opentui/react@0.2.16`.
- *unit (`tests/unit/prompts/init-wizard.test.ts`):* `expected "vi.fn()" to not be
  called at all, but actually been called 1 times`.

**Typecheck** — fails with, among others:
- zod-v4 `No overload matches this call` in `src/blueprints/types.ts`,
  `src/config/schema.ts` (taskmaster is on `zod@^4.3.6`).
- `Property 'qaFeedback' is missing in type … but required in 'TaskNode'`
  (`src/commands/add.ts`, `src/decomposer/expander.ts`, `src/parser/task-generator.ts`).
- `Cannot find name 'ParsedSection'` (`src/parser/index.ts`).
- `'--jsx' is not set` for `tui-view-components` `.tsx` imported as source.

## Root cause (diagnosed)

Independent pre-existing issues, none caused by the merge:
1. **Phantom dep:** taskmaster uses `tui-view-components` (→ `@opentui/react`) but
   doesn't declare `@opentui/core`/`@opentui/react`, unlike every sibling that
   uses `tui-view-components`. Its bundled CLI then can't resolve them under
   strict pnpm. Declaring them exposes a second issue: `@opentui/react@0.2.16`'s
   own `react-reconciler/constants` import doesn't resolve at runtime.
2. **App-code type errors** unrelated to layout (zod v4, missing `qaFeedback`,
   missing `ParsedSection` import).
3. **Unit test** asserts a mock isn't called, but it is.

## Acceptance criteria

- [ ] `pnpm --filter @ecruz165/taskmaster run typecheck` exits 0.
- [ ] `pnpm --filter @ecruz165/taskmaster run test` exits 0 on Node 22.
- [ ] Declare `@opentui/core` + `@opentui/react` (`^0.2.2`, matching siblings) and
      resolve the `react-reconciler/constants` runtime error (likely a
      react-reconciler version pin for `@opentui/react`).
- [ ] Fix the zod-v4 schema typings, add `qaFeedback` to the `TaskNode`
      constructions (or make it optional), import/define `ParsedSection`, and set
      `jsx` for the `tui-view-components` source imports.
- [ ] Fix or correct the `init-wizard` mock expectation.
- [ ] Remove the `taskmaster` typecheck + test exclusions from `ci.yml`.

## References

- Triage: conversation + `docs/MONOREPO-MIGRATION.md` "Known pre-existing issues".
