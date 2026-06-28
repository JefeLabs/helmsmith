# HELM-T2: gittyup — typecheck failures in src/ui/prompts.ts

**Labels:** `bug` · `area:gittyup` · `toolbox-backlog`
**Status:** ✅ RESOLVED
**CI exclusion:** removed (gittyup runs in the typecheck step again)
**Verified (Node 22):** `typecheck` 33 errors → 0; tests still 8/8; green under the parallel CI run.

## Resolution

Fixed in branch `fix/helm-t2-gittyup`. Two parts:
1. **Declared the undeclared deps** `@inquirer/core`/`@inquirer/ansi`/`@inquirer/figures`
   at the **8.x family** ranges (`^11.2.1` / `^2.0.7` / `^2.0.7`) to match
   `@inquirer/prompts@8` (used across 7 files) — single core version, no duplicate.
   This cleared 30 of 33 errors (the implicit-any / missing-property cascade from the
   unresolved module types).
2. **Migrated the custom `@inquirer/core` prompt to the core@11 API** (it was written
   against core@10): `keybindings: [] as string[]` → `[]` (core@11 wants
   `Keybinding[]`); `renderSelectedChoices(selection, items)` → 1-arg; dropped a bogus
   `color as string` cast so `node:util` `styleText` gets a valid `InspectColor`.

---

_Original report below._

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
