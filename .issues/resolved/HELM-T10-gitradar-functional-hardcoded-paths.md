# HELM-T10: gitradar functional test scans hardcoded local repos — fails in CI

**Labels:** `bug` · `area:apps` · `test` · `ci`
**Status:** ✅ RESOLVED (self-contained git fixtures — runs everywhere, incl. CI)
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

Made the suite **self-contained**: a `beforeAll` generates four throwaway git repos
(`buildRepo`) under a temp dir, each with controlled commits — authors, dates, files,
and line counts chosen to satisfy the pipeline assertions (4 repos, commits in the
last 4 weeks, app/test/config files, >100 insertions, clean deletions via line-count
shrink, a `git`-deletion path, and a mix of SkoolScout-mappable authors plus an
unassignable one so org-filtered records are a strict subset). The hardcoded
`/Users/...` paths and the interim `describe.skip` guard are gone; the suite now runs
everywhere, including CI. Only this file had hardcoded paths; sibling
`sqlite-store.test.ts` was already self-contained.

(First shipped as a `describe.skip`-when-absent guard so CI could go green
immediately; this change replaces that guard with real fixtures.)

Verified Node 22 + bun 1.3.14: full gitradar `test` green (vitest 804/804 + `test:bun`
37 pass) under both the local timezone and `TZ=UTC`; the functional suite is 19/19 on
generated data (326 insertions, 42 deletions, 3 authors across 4 repos).
