# HELM-T8: CI red on main — cli-kit's dist-typed exports don't resolve in a clean checkout

**Labels:** `bug` · `ci` · `area:core` · `build`
**Status:** ✅ RESOLVED (cli-kit made source-first, matching the other libs)
**CI exclusion:** none

## Discovery

Verified via `gh` (the `ecruz165` account has access to `JefeLabs/helmsmith`; the
default `edwin-skoolscout` account 404s — which is why CI status was never confirmed
earlier). **Every recent push to `main` failed CI** at the `js` job's *TypeScript
typecheck* step (the `controlplane` Maven job passed). So the "exclusion-free / green
CI" claims in the docs were aspirational, never actually checked.

```
apps/mech-pencil typecheck: src/cli.ts(10,27): error TS2307:
  Cannot find module '@ecruz165/cli-kit' or its corresponding type declarations.
apps/mech-pencil typecheck: src/cli.ts(228,43): error TS7006:
  Parameter 'e' implicitly has an 'any' type.   ← cascade from the unresolved import
```

## Root cause

`@ecruz165/cli-kit` exposed its API through **built artifacts**:

```json
"main": "./dist/index.js", "types": "./dist/index.d.ts",
"exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } }
```

But CI's `js` job is `install → typecheck → vitest` with **no build step**. A clean
checkout has no `dist/`, so every cli-kit consumer (mech-pencil, pritty, gittyup,
taskmaster…) fails to resolve its types. Locally it passed only because a **stale
`dist/`** (from an earlier build) masked it. cli-kit was the lone *imported* library
still on the built-package model — the other 18 libs (agent-adapter,
tui-view-components, …) are source-first (`exports: "./src/index.ts"`) and need no build.

Reproduced deterministically by moving the stale `dist/` dirs aside → `pnpm -r
typecheck` failed with the exact CI errors.

## Fix

Make cli-kit source-first, matching the rest of the monorepo:

```json
"main": "./src/index.ts",
"exports": { ".": "./src/index.ts" }
```

Consumers now resolve cli-kit's types **and** runtime from source — no build needed,
consistent with how apps bundle (`tsup` inlines `@ecruz165/*`) and run (`.ts` under
bun). No dependency change, so `pnpm install --frozen-lockfile` is unaffected.

Verified (Node 22, clean — all `dist/` removed): `pnpm -r typecheck` exit 0; full
`pnpm -r --if-present test` 3324 passed / 0 failed / 23 skipped / 3 todo.

## Follow-ups

- **Publish work (deferred, see ../docs/MONOREPO-MIGRATION.md):** source-first libs
  ship `.ts`, so the eventual `@jefelabs` publish needs a uniform build→dist + dist
  exports across all libs. Not a dev/CI concern today.
- Optional CI hardening: a clean-checkout guard (CI already is clean) and a lint rule
  that imported libs point `exports` at source, so a dist-typed lib can't silently
  re-break typecheck.
