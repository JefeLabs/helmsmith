# HELM-T2 — gittyup: typecheck failures in src/ui/prompts.ts

- **Status:** Open
- **Package:** `apps/gittyup`
- **Kind:** typecheck (pre-existing app debt)
- **CI:** excluded from typecheck in `.github/workflows/ci.yml`. Remove on close.
- **Verify locally:** `nvm use 22 && pnpm --filter @ecruz165/gittyup run typecheck`
  (tests already pass)

## Symptoms

`tsc --noEmit` fails in `src/ui/prompts.ts`:
- `error TS2307: Cannot find module '@inquirer/ansi'` (also `@inquirer/core`,
  `@inquirer/figures`).
- Cascade of `TS7006: Parameter '…' implicitly has an 'any' type` and
  `TS2339: Property 'checked'/'group' does not exist on …` — downstream of the
  missing module types.

## Root cause (diagnosed)

`src/ui/prompts.ts` imports `@inquirer/{core,ansi,figures}` (inquirer internals
for a custom prompt) but gittyup's `package.json` doesn't declare them — a phantom
dependency. With strict pnpm `node_modules`, the types don't resolve, which also
drops the inferred parameter types (the `implicit any` / missing-property cascade).
Not caused by the merge; surfaced by running gittyup's typecheck under CI for the
first time (toolbox had none).

## Acceptance criteria

- [ ] Add `@inquirer/core`, `@inquirer/ansi`, `@inquirer/figures` to gittyup's
      `dependencies` at versions compatible with `@inquirer/prompts@^8`.
- [ ] Resolve the residual `implicit any` / missing-property errors (most should
      clear once the modules' types resolve; annotate any that remain).
- [ ] `pnpm --filter @ecruz165/gittyup run typecheck` exits 0.
- [ ] Remove the `gittyup` typecheck exclusion from `ci.yml`.
