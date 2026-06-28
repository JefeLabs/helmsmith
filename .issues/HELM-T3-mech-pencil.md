# HELM-T3: mech-pencil — typecheck error (TS2352) + bun build postinstall

**Labels:** `bug` · `area:mech-pencil` · `ci-excluded` · `toolbox-backlog`
**Status:** Open
**CI exclusion:** typecheck only (`.github/workflows/ci.yml`) — remove on close.
Tests pass (19/19), so mech-pencil is NOT excluded from the test step.
**Repro (Node 22):** `pnpm --filter @ecruz165/mech-pencil run typecheck`

## Summary

`tsc --noEmit` fails on a bad cast in a test file; tests themselves pass.

## Symptoms

```
src/pen/builder.test.ts(12,13): error TS2352: Conversion of type 'Frame' to type
'Record<string, unknown>' may be a mistake … Index signature for type 'string' is
missing in type 'Frame'.
```

Separately, `pnpm --filter @ecruz165/mech-pencil run build`'s `bun build …`
sub-step fails with *"Bun's postinstall script was not run"* when the `bun` npm
package binary isn't initialized.

## Root cause

- **Typecheck:** genuine bad cast — `Frame` lacks a string index signature, so
  `as Record<string, unknown>` is rejected under strict mode. App code, pre-existing.
- **Build:** `bun`'s postinstall (which fetches its binary) is gated by pnpm.
  `onlyBuiltDependencies` now lists `bun`, so a fresh install initializes it; a
  stale `node_modules` needs `pnpm rebuild bun`.

## Acceptance criteria

- [ ] Fix `builder.test.ts:12` — cast through `unknown`, give `Frame` an index
      signature, or adjust the assertion.
- [ ] `pnpm --filter @ecruz165/mech-pencil run typecheck` exits 0.
- [ ] `pnpm --filter @ecruz165/mech-pencil run build` succeeds on a fresh install.
- [ ] Remove the mech-pencil typecheck exclusion from `ci.yml`.
