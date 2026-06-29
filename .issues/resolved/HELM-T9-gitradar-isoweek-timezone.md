# HELM-T9: gitradar getISOWeek is timezone-dependent — fails in CI (UTC)

**Labels:** `bug` · `area:apps` · `timezone` · `test`
**Status:** ✅ RESOLVED (compute ISO week in UTC; corrected test expectations)
**CI exclusion:** none

## Discovery

Surfaced once **HELM-T8** unblocked the typecheck step and CI finally reached the
vitest step: `apps/gitradar` → `src/__tests__/git.test.ts` → `getISOWeek` failed 3/78
on the CI runner (UTC) while passing locally (`America/New_York`):

```
returns correct week at year boundary: expected '2025-W52' … received '2026-W01'
handles week 1 of new year:            expected '2026-W01' … received '2026-W02'
handles mid-year dates:                expected '2026-W24' … received '2026-W25'
```

## Root cause

`getISOWeek` parsed a UTC instant but then read the calendar date with **local
getters**:

```js
const d = new Date(dateStr);                                  // e.g. '…T00:00:00Z'
const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));  // LOCAL getters
```

In a negative-offset zone (`America/New_York`, UTC−4/−5) a `…T00:00:00Z` timestamp is
the previous evening locally, so `getDate()` rolled back a day → a different ISO week.
The result differed between a dev machine and CI (UTC), and the tests (written in
NY) encoded the **shifted, incorrect** values — so they passed locally and failed in
CI. (CI's values were actually the correct ISO weeks.)

## Fix

Use UTC getters so the ISO week derives from the instant's UTC calendar date —
deterministic everywhere:

```js
const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
```

Corrected the three test expectations to the true ISO weeks (and changed the
"week 1 of new year" date to `2026-01-02`, which is genuinely in W01, to keep the
test's intent):

- `2025-12-29` → **2026-W01** (its week's Thursday is 2026-01-01)
- `2026-01-02` → **2026-W01**
- `2026-06-15` → **2026-W25**

Verified (Node 22): identical output under `America/New_York`, `UTC`, and
`Asia/Tokyo`; gitradar 804/804 under both NY and UTC; full suite under `TZ=UTC`
3324 passed / 0 failed.
