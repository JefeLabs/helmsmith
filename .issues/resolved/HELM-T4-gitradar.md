# HELM-T4: gitradar — db-watcher.test.ts flaky under parallel load

**Labels:** `flaky-test` · `area:gitradar`
**Status:** ✅ RESOLVED
**CI exclusion:** removed — and it was the **last** one, so the CI test step now runs
all suites with no `--filter` exclusions (typecheck is already exclusion-free).
**Verified (Node 22):** 0/8 failures under an 8-core CPU-saturation stress loop (was
2/2); full `pnpm -r test` (gitradar included) exits 0.

## Resolution

Fixed in branch `fix/helm-t4-gitradar`. `vi.waitFor` alone wasn't enough — under
saturation, `fs.watch` *event delivery itself* starves, so no timeout is reliable.
Made the logic deterministic instead:
- Extracted the fs.watch callback body into a public `DbWatcher.handleFsEvent()`
  (a test seam; behavior unchanged in production).
- Rewrote `db-watcher.test.ts`'s change-detection tests to drive `handleFsEvent()`
  directly with **fake timers** (`vi.useFakeTimers()` + `advanceTimersByTime(150)`),
  removing any dependency on real OS file-watch delivery or wall-clock sleeps. The
  filter + debounce + abort logic is now tested deterministically; `start()`'s real
  fs.watch wiring stays covered by the idempotency tests.

---

_Original report below._

**Repro:** passes in isolation; previously failed only under the recursive parallel run.

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
