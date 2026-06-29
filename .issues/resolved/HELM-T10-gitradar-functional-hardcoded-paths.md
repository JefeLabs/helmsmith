# HELM-T10: gitradar functional test scans hardcoded local repos — fails in CI

**Labels:** `bug` · `area:apps` · `test` · `ci`
**Status:** ✅ RESOLVED (skip when repos absent) · ⏩ follow-up: make self-contained
**CI exclusion:** none

## Discovery

Surfaced once HELM-T8 + HELM-T9 let CI reach gitradar's `test:bun` step (`vitest run
&& bun run test:bun`). `src/__tests__/functional.test.ts` failed **14/37** on the CI
runner — `Received: 0` for every commit/metric assertion, and a
`SyntaxError: JSON Parse error: Unexpected identifier "No"` (the CLI emits a `No
data…` message instead of JSON when a scan is empty, which the test then `JSON.parse`s).

## Root cause

The suite scans **hardcoded absolute paths on the author's machine**:

```js
const SKOOLSCOUT_ROOT = '/Users/edwincruz/Development/Workspaces/skoolscout';
const TEST_REPOS = [ { path: join(SKOOLSCOUT_ROOT, 'skoolscout-com') }, … ];
```

Those repos exist only on that machine, so the scan finds nothing in CI (or on any
other developer's machine) → 0 commits → empty-scan failures. The test passed locally
only because the repos are present there. It's an "against real git repos" integration
test that was never runnable in CI.

## Fix

Skip the suite when its repos aren't present, so it runs locally for the author and
skips cleanly elsewhere:

```js
const REPOS_PRESENT = TEST_REPOS.every((r) => existsSync(r.path));
const describeIfRepos = REPOS_PRESENT ? describe : describe.skip;
describeIfRepos('Functional: Full CLI Pipeline (Engine + SQLite)', () => { … });
```

(`describe.skip` verified under bun:test — skips without running.) Only this file had
hardcoded `/Users/...` paths (repo-wide grep); the sibling `sqlite-store.test.ts` is
self-contained and still runs in CI.

Verified Node 22 + bun 1.3.14: gitradar full `test` green locally (vitest 804/804 +
`test:bun` 37 pass); the suite skips when the paths are absent.

## Follow-up (open)

Make the suite **self-contained** — generate throwaway git repos with known commits
in `beforeAll` (temp dir) instead of scanning personal paths — so it provides CI value
on every machine. Tracked by the `TODO(HELM-T10)` marker in the test. Until then this
integration suite is local-only (skipped in CI).
