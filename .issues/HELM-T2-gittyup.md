# HELM-T2: gittyup — typecheck failures in src/ui/prompts.ts

**Labels:** `bug` · `area:gittyup` · `ci-excluded` · `toolbox-backlog`
**Status:** Open
**CI exclusion:** typecheck (`.github/workflows/ci.yml`) — remove on close
**Repro (Node 22):** `pnpm --filter @ecruz165/gittyup run typecheck` (tests already pass)

## Summary

`tsc --noEmit` fails in `src/ui/prompts.ts`; tests are green.

## Symptoms

- `TS2307: Cannot find module '@inquirer/ansi'` (also `@inquirer/core`,
  `@inquirer/figures`).
- Cascade of `TS7006: Parameter '…' implicitly has an 'any' type` and
  `TS2339: Property 'checked'/'group' does not exist on …` — downstream of the
  missing module types.

## Root cause

`src/ui/prompts.ts` imports inquirer internals (`@inquirer/{core,ansi,figures}`)
for a custom prompt, but gittyup's `package.json` doesn't declare them — a phantom
dependency. Under strict pnpm the types don't resolve, which collapses the inferred
parameter types (the `implicit any` / missing-property cascade). Surfaced by
running gittyup's typecheck under CI for the first time.

## Acceptance criteria

- [ ] Add `@inquirer/core`, `@inquirer/ansi`, `@inquirer/figures` to gittyup's
      `dependencies`, compatible with `@inquirer/prompts@^8`.
- [ ] Clear residual `implicit any` / missing-property errors (most resolve once
      the module types are present; annotate any that remain).
- [ ] `pnpm --filter @ecruz165/gittyup run typecheck` exits 0.
- [ ] Remove the gittyup typecheck exclusion from `ci.yml`.
