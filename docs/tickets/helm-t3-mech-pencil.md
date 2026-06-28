# HELM-T3 — mech-pencil: typecheck error + bun build postinstall

- **Status:** Open
- **Package:** `apps/mech-pencil`
- **Kind:** typecheck (pre-existing app debt) + build env
- **CI:** excluded from typecheck in `.github/workflows/ci.yml`. Remove on close.
  (Tests pass — `19/19` files — so mech-pencil is NOT excluded from the test step.)
- **Verify locally:** `nvm use 22 && pnpm --filter @ecruz165/mech-pencil run typecheck`

## Symptoms

`tsc --noEmit` fails:
```
src/pen/builder.test.ts(12,13): error TS2352: Conversion of type 'Frame' to type
'Record<string, unknown>' may be a mistake because neither type sufficiently
overlaps with the other. … Index signature for type 'string' is missing in 'Frame'.
```

Separately, `pnpm --filter @ecruz165/mech-pencil run build` fails its
`bun build …` sub-step with *"Bun's postinstall script was not run"* when the
`bun` npm package's binary hasn't been initialized (pnpm gates install scripts).

## Root cause (diagnosed)

- **Typecheck:** a genuine bad cast in a test file — `Frame` lacks a string index
  signature, so `as Record<string, unknown>` is rejected by strict mode. App code,
  pre-existing.
- **Build:** the `bun` npm package needs its postinstall to fetch the bun binary.
  `onlyBuiltDependencies` now lists `bun`, so a fresh install should initialize it;
  if a stale `node_modules` predates that, run `pnpm rebuild bun` (or reinstall).

## Acceptance criteria

- [ ] Fix `builder.test.ts:12` — cast through `unknown` (`as unknown as Record<…>`)
      or give `Frame` an index signature / adjust the assertion.
- [ ] `pnpm --filter @ecruz165/mech-pencil run typecheck` exits 0.
- [ ] Confirm `pnpm --filter @ecruz165/mech-pencil run build` succeeds on a fresh
      install (bun postinstall runs via `onlyBuiltDependencies`).
- [ ] Remove the `mech-pencil` typecheck exclusion from `ci.yml`.
