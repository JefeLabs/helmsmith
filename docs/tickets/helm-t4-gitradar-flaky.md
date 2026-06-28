# HELM-T4 — gitradar: db-watcher.test.ts flaky under parallel load

- **Status:** Open
- **Package:** `apps/gitradar`
- **Kind:** flaky test (not a deterministic failure)
- **CI:** excluded from test in `.github/workflows/ci.yml`. Remove on close.
- **Verify locally:** passes in isolation
  (`pnpm --filter @ecruz165/gitradar run test` → exit 0, 38 vitest files + 37 bun
  tests). Fails only when run concurrently with the rest of the workspace.

## Symptoms

In isolation: green (vitest `38 files / 804 tests`, then `bun test` `37 pass / 0
fail`). Under the recursive parallel run (`pnpm -r --if-present test`, default
concurrency):
```
apps/gitradar test:  ❯ src/__tests__/db-watcher.test.ts (11 tests | 2 failed)
```
Only `db-watcher.test.ts` flakes, and only under CPU contention.

## Root cause (diagnosed)

A file-watcher test that is timing-sensitive — it relies on debounce/poll windows
that miss their deadline when many vitest workers run concurrently and starve the
event loop. Classic load-dependent flake; not merge-related (gitradar's code didn't
move and passes standalone). The CI runner (fewer cores) may or may not reproduce
it, but excluding the package keeps CI deterministic until the test is hardened.

## Acceptance criteria

- [ ] Make `db-watcher.test.ts` robust under load — e.g. `vi.useFakeTimers()` to
      control the watch/debounce window, increase the per-test timeout, or
      `await vi.waitFor(...)` on the observable effect instead of a fixed sleep.
- [ ] `pnpm -r --if-present test` (full parallel) is green with gitradar included,
      across several consecutive runs.
- [ ] Remove the `gitradar` test exclusion from `ci.yml`.

## Note

If isolation is acceptable long-term, an alternative is to keep gitradar in CI but
pin its watcher tests to a single worker (`test.sequential` / a dedicated vitest
project) rather than excluding the whole package.
