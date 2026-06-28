# HELM-T4: gitradar — db-watcher.test.ts flaky under parallel load

**Labels:** `flaky-test` · `area:gitradar` · `ci-excluded`
**Status:** Open
**CI exclusion:** test (`.github/workflows/ci.yml`) — remove on close
**Repro:** passes in isolation (`pnpm --filter @ecruz165/gitradar run test` → exit 0,
38 vitest files + 37 bun tests). Fails only under the recursive parallel run.

## Summary

Not a deterministic failure — `src/__tests__/db-watcher.test.ts` is timing-flaky
under CPU contention.

## Symptoms

In isolation: green. Under `pnpm -r --if-present test` (default concurrency):
```
apps/gitradar test:  ❯ src/__tests__/db-watcher.test.ts (11 tests | 2 failed)
```
Only `db-watcher.test.ts` flakes, and only under load.

## Root cause

A file-watcher test relying on real debounce/poll windows that miss their deadline
when many vitest workers starve the event loop. Load-dependent flake; not
merge-related (gitradar didn't move and passes standalone). CI runners (fewer
cores) may not always reproduce it, but excluding the package keeps CI
deterministic until the test is hardened.

## Acceptance criteria

- [ ] Harden `db-watcher.test.ts` under load — `vi.useFakeTimers()` for the
      watch/debounce window, `vi.waitFor(...)` on the observable effect instead of
      fixed sleeps, or a higher per-test timeout.
- [ ] `pnpm -r --if-present test` (full parallel) is green with gitradar included
      across several consecutive runs.
- [ ] Remove the gitradar test exclusion from `ci.yml`.

## Alternative

Keep gitradar in CI but pin its watcher tests to a single worker
(`test.sequential` or a dedicated vitest project) instead of excluding the package.
