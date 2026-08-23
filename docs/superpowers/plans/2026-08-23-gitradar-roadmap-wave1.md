# GitRadar Roadmap Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the wrong-number and corrupt-data bugs in GitRadar's older surfaces, make the CLI/config/docs tell the truth (Bun-only, no `config.yml repos:`, `--force-scan` really re-walks), and rename/retire the mislabeled enrichment metrics.

**Architecture:** Small, test-first changes to existing modules; no restructuring (that is wave 2). Holder records (`commits = 0`) become invisible to every "who was active" consumer; bot exclusion reaches the last unguarded surface; `--force-scan` clears that repo's records and cursors before re-walking; enrichment fields are renamed end-to-end (SQLite `RENAME COLUMN` migration, TS, CSV, UI) and churn computation is removed in favour of `rework%`.

**Tech Stack:** TypeScript (ESM), Bun runtime (`bun:sqlite`), simple-git, zod, commander via `@helmsmith/cli-kit`, chalk, vitest + `bun test`, biome.

**Spec:** `apps/gitradar/docs/roadmap.md` (wave 1 = "Parked follow-ups", all of Tier 1 except reverts/co-authors/cherry-picks, the Tier 2 items decided below, plus docs/packaging truth). Decisions made with the user on 2026-08-23: **commit to Bun**; **remove `config.yml repos:`**; **`--force-scan` clears cursors**; **rename enrichment fields and retire churn**.

## Global Constraints

- Package: `apps/gitradar`. Run commands from that directory unless stated. Tests: `npx vitest run <file>`; bun suites: `bun test <file>` (each store suite in its own invocation — see `package.json` `test:bun`); full: `npm test`; typecheck `npx tsc --noEmit`; lint/format from repo root `npx biome check --write apps/gitradar`.
- Store tests that open a DB MUST set `process.env.GITRADAR_HOME` to a temp dir and guard on `getSQLitePath()` (pattern: `src/__tests__/sqlite-scorecard.test.ts`). Never run `scan`, `--reset`, or `enrich` against the real `~/.agentx`.
- Never stage or modify `Makefile` (unrelated user edit in the working tree).
- TDD for every code change: failing test first, then the fix. Commit messages conventional (`fix(gitradar): …`), ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Naming: camelCase TS, snake_case SQLite/CSV. Exact new names: `median_cycle_hrs` (was `avg_cycle_hrs`), `prs_reviewed_touched` (was `reviews_given`); `churn_rate_pct` is retired (column kept, value no longer computed or shown).
- "Holder record" = a `UserWeekRepoRecord` with `commits === 0` (created by the PR proxy / rework passes). It must never count as an active week, active member, headcount, or segment-cohort member.

---

## File Structure

| File | Responsibility in this wave |
|---|---|
| `src/collector/index.ts` | rework window bound (24-week floor); `--force-scan` clears cursors + calls `onRepoReset` |
| `src/collector/git.ts` | `dateDay` derived from the same UTC instant as `week` |
| `src/store/scan-state.ts` | `rotateHashes` cap raised to 5000 with rationale |
| `src/store/sqlite-store.ts` | `reattributeRecordsSQL` updates `member`; enrichment column rename migration; friendly open error |
| `src/commands/assign-author.ts` | derive `orgType`/`tag`/`member` from config + registry |
| `src/views/components/top-performers-section.ts`, `src/aggregator/leaderboard.ts` | bot exclusion; drop zero-total summaries |
| `src/aggregator/trends.ts`, `src/views/member-detail.ts`, `src/views/team-detail.ts` | holder gating; all filetype sums via `aggregator/metrics.ts` |
| `src/views/components/contribution-section.ts` | pivot holder gate; "Avg" label; churn column removal |
| `src/views/dashboard.ts` | CSV count message; segment menu uses configured %; `H` default; `view trends` no-scan |
| `src/commands/repo-activity.ts` | pass `botPatterns` |
| `src/types/schema.ts`, `src/collector/github.ts`, `src/engine/gitradar-engine.ts`, `src/commands/enrich.ts`, `src/commands/export-data.ts`, `src/ui/grouped-hbar-chart.ts`, `src/aggregator/scorecard.ts`, `src/demo.ts` | enrichment rename + churn retirement |
| `src/config/loader.ts`, `src/config/repos-registry.ts`, `src/cli.ts`, `src/engine/gitradar-engine.ts` | `repos:` ignored with a warning; zod detail for `repos.yml`; `--prune` weeks; corrupt-DB message; `view trends --no-scan` |
| `package.json`, `README.md`, `docs/*.md` | Bun-only truth, dead-end commands, links, counts |

---

### Task 1: Parked Scorecard follow-ups (batch)

**Files:**
- Modify: `src/collector/index.ts` (rework bound, ~L149), `src/views/dashboard.ts` (TUI CSV export message, ~L1633), `src/views/components/contribution-section.ts` (by-entity segmentation, ~L1180-1190), `src/commands/repo-activity.ts` (~L73)
- Test: `src/__tests__/collector-index.test.ts`, `src/__tests__/dashboard-export.test.ts`, `src/__tests__/contribution-section.test.ts`, `src/__tests__/repo-activity.test.ts` (create if absent)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/collector-index.test.ts` (next to the existing "inputs older than the bound are not passed to runRework" test):

```ts
  it('bounds rework inputs to at least 24 weeks even when weeks_back is small', async () => {
    const cfg = makeConfig({ settings: { ...DEFAULT_SETTINGS, weeks_back: 4 } });
    const recent = getLastNWeeks(24, getCurrentWeek());
    const inWindow = recent[0];           // 24 weeks back — must still be blamed
    const tooOld = getLastNWeeks(30, getCurrentWeek())[0]; // 30 weeks back — dropped
    vi.mocked(scanRepo).mockResolvedValueOnce(makeScanResult({
      newRecords: [makeRecord('Alice', 'app')], newHashes: ['h1'], commitCount: 2,
      reworkInputs: [
        { hash: 'h1', authorEmail: 'a', authorName: 'A', authorDate: '2026-01-01T00:00:00Z', week: inWindow, files: [{ path: 'x', deletions: 1 }] },
        { hash: 'h2', authorEmail: 'a', authorName: 'A', authorDate: '2026-01-01T00:00:00Z', week: tooOld, files: [{ path: 'y', deletions: 1 }] },
      ],
    }));
    vi.mocked(runPrProxy).mockResolvedValueOnce({ records: [], newPrHashes: [], prCount: 0, branch: 'main' });
    vi.mocked(runRework).mockResolvedValueOnce({ records: [], commitsProcessed: 1, blames: 1 });
    await scanAllRepos(cfg, makeScanState(), {});
    const passed = vi.mocked(runRework).mock.calls[0][0].map((i) => i.hash);
    expect(passed).toEqual(['h1']);
  });
```

`src/__tests__/dashboard-export.test.ts` (extend the existing export test; it already drives the `m` → export flow with a captured `console.log`):

```ts
  it('reports the number of rows actually written (bots excluded)', async () => {
    // records: 2 humans + 1 bot; settings.bot_patterns includes 'dependabot'
    // ...drive the export as the existing test does...
    expect(logged.join('\n')).toMatch(/Exported 2 records to/);
  });
```

`src/__tests__/contribution-section.test.ts`:

```ts
  it('by-entity pivot segmentation ignores holder-only entities', () => {
    // 8 real members (commits > 0) + 1 member whose only records have commits: 0
    // render with pivotEntity: true, drillLevel 'user', excludedSegments = new Set(['low'])
    // expect: holder member still renders (not hidden) and the 8 real members' segment labels
    //         are identical to rendering WITHOUT the holder present (n stays 8).
  });
```

Implement that test concretely: build `records` with `makeRecord` (file's helper), call the exported `renderContributionsTab` twice (with/without the holder) into captured output via `vi.spyOn(console, 'log')`, strip ANSI, and compare the `★`/segment glyph prefix of each real member's group label between the two runs.

`src/__tests__/repo-activity.test.ts` (new or extend): assert `repoActivity({ records, botPatterns: ['[bot]'] })` calls the rollup without bot rows — since the command uses `queryRollup` from the DB path, test the pre-loaded `records` path: a bot member's lines do not appear in the repo totals when `botPatterns` is given.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/collector-index.test.ts src/__tests__/dashboard-export.test.ts src/__tests__/contribution-section.test.ts src/__tests__/repo-activity.test.ts`
Expected: the four new tests FAIL (bound uses `weeks_back*2 = 8`; message says 3; holder shifts n; bots counted).

- [ ] **Step 3: Implement**

`src/collector/index.ts`: replace `getLastNWeeks(config.settings.weeks_back * 2)` with

```ts
// The Scorecard can always reach a 12-week window + 12-week baseline regardless of
// weeks_back, so never blame less than 24 weeks of history.
const REWORK_MIN_WEEKS = 12;
const analysableWeeks = new Set(
  getLastNWeeks(Math.max(config.settings.weeks_back, REWORK_MIN_WEEKS) * 2),
);
```

`src/views/dashboard.ts` TUI export: compute `const exportRecords = excludeBots(ctx.records, ctx.config.settings.bot_patterns ?? []);` once, pass it to `recordsToCsv(...)`, and log `Exported ${exportRecords.length} records to ${outPath}`.

`src/views/components/contribution-section.ts` by-entity branch (~L1180): when building `entityTotals`, skip groups whose bars all come from holder records. The group objects carry `bars[].commits` (check `HBar` in `src/ui/grouped-hbar-chart.ts`; if `commits` is absent on bars, add an optional `commits?: number` stamped from `agg.commits` where bars are built in `buildContributionGroupsByEntity`). Rule: `const active = g.bars.some((b) => (b.commits ?? 0) > 0); if (!active) continue;`.

`src/commands/repo-activity.ts`: add `botPatterns?: string[]` to its options, apply `excludeBots` on the pre-loaded path and pass `botPatterns` into `queryRollup`'s filters on the DB path; wire from `src/cli.ts` using the existing `loadSettings()` helper.

- [ ] **Step 4: Run tests, full suite, typecheck, biome**

Run: `npx vitest run src/__tests__/collector-index.test.ts src/__tests__/dashboard-export.test.ts src/__tests__/contribution-section.test.ts src/__tests__/repo-activity.test.ts && npm test && npx tsc --noEmit && (cd ../.. && npx biome check --write apps/gitradar)`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/collector/index.ts src/views/dashboard.ts src/views/components/contribution-section.ts src/commands/repo-activity.ts src/cli.ts src/ui/grouped-hbar-chart.ts src/__tests__
git commit -m "fix(gitradar): scorecard follow-ups — 24-week rework floor, honest export count, pivot holder gate, repo-activity bots

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Top Performers excludes bots and zero-total members

**Files:**
- Modify: `src/views/components/top-performers-section.ts:94`, `src/aggregator/leaderboard.ts:92-117`
- Test: `src/__tests__/leaderboard.test.ts`, `src/__tests__/views.test.ts`

**Interfaces:**
- Produces: `computeLeaderboard(records, weeks, topN, botPatterns: string[] = [])` — bots removed before rollup; members whose total lines are 0 never occupy a slot.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/leaderboard.test.ts`:

```ts
  it('excludes bot authors when botPatterns is given', () => {
    const records = [
      makeRecord({ member: 'alice', email: 'a@co.com' }),
      makeRecord({ member: 'dependabot[bot]', email: 'd@x', filetype: { ...makeRecord().filetype, app: { files: 9, filesAdded: 0, filesDeleted: 0, insertions: 99999, deletions: 0 } } }),
    ];
    const [overall] = computeLeaderboard(records, ['2026-W08'], 5, ['[bot]']);
    expect(overall.entries.map((e) => e.member)).toEqual(['alice']);
  });

  it('never seats a member whose total lines are zero', () => {
    const records = [makeRecord({ member: 'alice' }), makeRecord({ member: 'holder', commits: 0, filetype: zeroFiletype() })];
    const [overall] = computeLeaderboard(records, ['2026-W08'], 5);
    expect(overall.entries.map((e) => e.member)).toEqual(['alice']);
  });
```

(`zeroFiletype()` = all five categories with zeros; add it to the file's helpers.)

`src/__tests__/views.test.ts`: `renderTopPerformersTab(ctx, 4)` with `ctx.config.settings.bot_patterns = ['[bot]']` and a bot record → the rendered output (captured `console.log`, `stripAnsi`) does not contain `dependabot`.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/leaderboard.test.ts src/__tests__/views.test.ts` → new tests FAIL.

- [ ] **Step 3: Implement**

`leaderboard.ts`: add the 4th parameter, `const filtered = excludeBots(records.filter((r) => weekSet.has(r.week)), botPatterns);` and `if (total === 0) continue;` when pushing summaries. `top-performers-section.ts`: `renderLeaderboard(records, currentWeek, windowWeeks, botPatterns = [])` → forwards to `computeLeaderboard`; `renderTopPerformersTab` passes `ctx.config.settings.bot_patterns ?? []`. Keep `commands/leaderboard.ts` behaviour (it already excludes bots up front; pass its `botPatterns` through too).

- [ ] **Step 4: Verify** — same files + `npm test && npx tsc --noEmit` + biome.
- [ ] **Step 5: Commit** — `fix(gitradar): Top Performers excludes bots and zero-total members`.

---

### Task 3: `assign-author` derives orgType/tag and re-attributes `member`

**Files:**
- Modify: `src/commands/assign-author.ts`, `src/store/sqlite-store.ts:1265-1286`
- Test: `src/__tests__/assign-author.test.ts` (new, vitest, store mocked) and `src/__tests__/sqlite-scorecard.test.ts` (bun; add a `reattributeRecordsSQL` case)

**Interfaces:**
- Produces: `resolveAssignment(config: Config, orgName: string, teamName: string): { orgType: 'core' | 'consultant'; tag: string }` exported from `assign-author.ts` (throws `Error('Unknown org: <name>')` when the org is not in `config.orgs`; team tag defaults to `'default'` when the team is not listed). `reattributeRecordsSQL(updates: Array<{ email; member; org; orgType; team; tag }>)` — `member` now required and written.

- [ ] **Step 1: Failing tests**

`src/__tests__/assign-author.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveAssignment } from '../commands/assign-author.js';
import type { Config } from '../types/schema.js';

const config = {
  orgs: [
    { name: 'Acme', type: 'core', teams: [{ name: 'FE', tag: 'web', members: [] }] },
    { name: 'ContractCo', type: 'consultant', teams: [{ name: 'Squad', tag: 'default', members: [] }] },
  ],
} as unknown as Config;

describe('resolveAssignment', () => {
  it('derives orgType and tag from config', () => {
    expect(resolveAssignment(config, 'ContractCo', 'Squad')).toEqual({ orgType: 'consultant', tag: 'default' });
    expect(resolveAssignment(config, 'Acme', 'FE')).toEqual({ orgType: 'core', tag: 'web' });
  });
  it('falls back to tag default for an unknown team and throws for an unknown org', () => {
    expect(resolveAssignment(config, 'Acme', 'Nope')).toEqual({ orgType: 'core', tag: 'default' });
    expect(() => resolveAssignment(config, 'Ghost', 'FE')).toThrow(/Unknown org/);
  });
});
```

`src/__tests__/sqlite-scorecard.test.ts` (bun):

```ts
  it('reattributeRecordsSQL rewrites member as well as org/team/tag', () => {
    store.upsertRecords([makeRecord({ member: 'ecruz', email: 'e@co.com', org: 'unassigned', team: 'unassigned' })]);
    store.reattributeRecordsSQL([{ email: 'e@co.com', member: 'Edwin Cruz', org: 'Acme', orgType: 'consultant', team: 'FE', tag: 'web' }]);
    const [row] = store.queryRecords({});
    expect(row.member).toBe('Edwin Cruz');
    expect(row.orgType).toBe('consultant');
    expect(row.tag).toBe('web');
  });
```

- [ ] **Step 2: Run to verify failure** — assign-author suite fails to import `resolveAssignment`; bun test fails on `member`.

- [ ] **Step 3: Implement**

`sqlite-store.ts`: `UPDATE records SET member = @member, org = @org, org_type = @org_type, team = @team, tag = @tag WHERE email = @email` (bind `member`). Because `(member, week, repo)` is the primary key, a rename can collide with an existing row for the same week/repo; run the UPDATE inside a transaction with `INSERT OR REPLACE`-free semantics: first `SELECT` colliding keys and merge them via the existing upsert merge (call `upsertRecords` on the renamed rows after deleting the old ones). Simplest correct implementation: `const rows = queryRecords({ email })` → map each to `{ ...r, member, org, orgType, team, tag }` → `DELETE FROM records WHERE email = @email` → `upsertRecords(mapped)`. Test with two rows that collide after rename (same week/repo) and assert counters summed.

Update every caller of `reattributeRecordsSQL` to pass `member` (grep `reattributeRecordsSQL` in `src` — the TUI assignment flow in `src/views/dashboard.ts` / `src/views/manage-tab.ts` calls it too). `assign-author.ts`: add `resolveAssignment`; in both commands replace the hard-coded `orgType: 'core', tag: 'default'` with the resolved values and set `member` to the config member name if `config.orgs[].teams[].members[]` has an entry with that email, else the registry author's `name`. Remove the unused `_authorMap`/`_identifierRules` locals.

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/assign-author.test.ts && bun test src/__tests__/sqlite-scorecard.test.ts && npm test && npx tsc --noEmit` + biome.
- [ ] **Step 5: Commit** — `fix(gitradar): author assignment derives orgType/tag from config and re-attributes member`.

---

### Task 4: `--force-scan` clears cursors and replaces the repo's records

**Files:**
- Modify: `src/collector/index.ts:86-135`, `src/engine/gitradar-engine.ts` (`scan()` ~L247, `rescanRepo` ~L300), `src/cli.ts:81,138`
- Test: `src/__tests__/collector-index.test.ts`

**Interfaces:**
- Produces: `scanAllRepos` options gain `onRepoReset?: (repoName: string) => Promise<void>`; when `forceScan` is true the loop calls it before `scanRepo`, passes `since: undefined`, `recentHashes: new Set()`, `recentPrHashes: new Set()`, and the stored `recentHashes`/`recentPrHashes` are replaced (not rotated into) by the fresh scan's hashes.

- [ ] **Step 1: Failing tests**

```ts
  it('forceScan ignores since and both hash cursors and resets the repo first', async () => {
    const state = makeScanState({ app: { lastHash: 'x', lastScanDate: '2026-03-01T00:00:00Z', recentHashes: ['old1'], recordCount: 3, recentPrHashes: ['m1'] } });
    vi.mocked(scanRepo).mockResolvedValueOnce(makeScanResult({ newHashes: ['n1'], commitCount: 1 }));
    vi.mocked(runPrProxy).mockResolvedValueOnce({ records: [], newPrHashes: ['m9'], prCount: 1, branch: 'main' });
    vi.mocked(runRework).mockResolvedValueOnce({ records: [], commitsProcessed: 0, blames: 0 });
    const reset: string[] = [];
    const result = await scanAllRepos(makeConfig(), state, { forceScan: true, onRepoReset: async (n) => { reset.push(n); } });
    expect(reset).toEqual(['app']);
    expect(vi.mocked(scanRepo)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ since: undefined, recentHashes: new Set() }));
    expect(vi.mocked(runPrProxy)).toHaveBeenCalledWith(expect.objectContaining({ since: undefined, recentPrHashes: new Set() }));
    expect(result.updatedScanState.repos.app.recentHashes).toEqual(['n1']);
    expect(result.updatedScanState.repos.app.recentPrHashes).toEqual(['m9']);
  });

  it('a normal scan keeps since and rotates cursors (regression guard)', async () => { /* existing behaviour: since = lastScanDate-1d, rotateHashes */ });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/collector-index.test.ts`.

- [ ] **Step 3: Implement**

`collector/index.ts`: after the path check, `if (forceScan) { await options?.onRepoReset?.(repoName); }`; compute `since`/cursors as `forceScan ? undefined / new Set() : existing`; when updating state use `forceScan ? result.newHashes.slice(0, 5000) : rotateHashes(existing, result.newHashes)` (same for PR hashes). Engine `scan()`: pass `onRepoReset: async (name) => { deleteRecordsForRepo(name); deleteScanStateForRepo(name); }`. `rescanRepo` already deletes; it may drop its own delete calls in favour of the callback. `cli.ts`: help text → `'Full re-scan: clears this workspace's cursors and records, then re-walks history'` (both places). `README.md`/`docs/feature-overview.md` lines describing `--force-scan` updated to match.

- [ ] **Step 4: Verify** — file + `npm test` + tsc + biome. Manual: none against real data.
- [ ] **Step 5: Commit** — `fix(gitradar): --force-scan clears cursors and replaces the repo's records`.

---

### Task 5: Holder-record gating + `metrics.ts` sums in trends / member detail / team detail; "Avg" label

**Files:**
- Modify: `src/aggregator/trends.ts:100-135` (`computeRunningAvg`; delete `computeRunningAvgByOrg` — zero callers), `src/views/member-detail.ts:160-190` (`computeSummary`), `src/views/team-detail.ts:22-60,92-112,180-210`, `src/views/components/contribution-section.ts:350-395` (Avg label), `src/aggregator/metrics.ts` (export `recordTotalLines(r)`)
- Test: `src/__tests__/trends.test.ts`, `src/__tests__/views.test.ts`, `src/__tests__/metrics.test.ts` (create)

**Interfaces:**
- Produces: `recordTotalLines(r: UserWeekRepoRecord): number` in `metrics.ts` = Σ over all five filetypes of `insertions + deletions` (doc included). `computeRunningAvg(records, team, currentWeek, windowWeeks)` counts only records with `commits > 0` toward `headcount` and `weeksActive` and uses `recordTotalLines`.

- [ ] **Step 1: Failing tests**

`src/__tests__/metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recordTotalLines } from '../aggregator/metrics.js';
// build a record with app 10+2, test 5+0, config 1+1, storybook 0+0, doc 7+3
it('recordTotalLines sums all five filetypes including doc', () => {
  expect(recordTotalLines(rec)).toBe(29);
});
```

`src/__tests__/trends.test.ts`:

```ts
  it('computeRunningAvg ignores holder records for headcount and active weeks', () => {
    const records = [
      makeRecord({ member: 'alice', team: 'Platform', week: '2026-W08', commits: 3 }),           // 200 lines (fixture)
      makeRecord({ member: 'bob', team: 'Platform', week: '2026-W08', commits: 0, activeDays: 0, filetype: zeroFiletype(), reworkLines: 5 }),
      makeRecord({ member: 'alice', team: 'Platform', week: '2026-W07', commits: 0, activeDays: 0, filetype: zeroFiletype(), prsMergedGit: 1 }),
    ];
    // headcount 1 (bob is holder-only), weeksActive 1 (W07 is holder-only) → 200 / 1 / 1
    expect(computeRunningAvg(records, 'Platform', '2026-W08', 12)).toBe(200);
  });
  it('computeRunningAvg includes doc lines', () => { /* record with only doc lines → non-zero avg */ });
```

`src/__tests__/views.test.ts`: member detail `12w Summary` line for a member with doc-only insertions shows a non-zero `+lines/wk`; team detail "Top Contributor" picks the doc-heavy member when their total (incl. doc) is highest; a holder-only member does not change another member's running avg marker.

- [ ] **Step 2: Run to verify failure** — the three files; `recordTotalLines` missing, avg includes holder/doc wrong.

- [ ] **Step 3: Implement**

`metrics.ts`:

```ts
/** Lines touched by one record across ALL filetypes (app, test, config, storybook, doc). */
export function recordTotalLines(r: Pick<UserWeekRepoRecord, 'filetype'>): number {
  const ft = r.filetype;
  return (
    totalLines(ft.app) + totalLines(ft.test) + totalLines(ft.config) + totalLines(ft.storybook) + totalLines(ft.doc ?? { insertions: 0, deletions: 0 })
  );
}
```

`trends.ts` `computeRunningAvg`: `for (const r of filtered) { if (r.commits === 0) continue; totalLines += recordTotalLines(r); members.add(r.member); activeWeeks.add(r.week); }`; delete `computeRunningAvgByOrg` and its test(s). `member-detail.ts` `computeSummary`: skip `commits === 0` records for `activeWeeks`; `totalInsertions` = Σ insertions over all five filetypes. `team-detail.ts`: replace the three inline 4-filetype sums with `recordTotalLines(r)`; `activeWeeks` from records with `commits > 0`. `contribution-section.ts` Avg column header/legend: label the value as `avg*` and add to the legend line `* trailing average incl. current period` (no computation change).

- [ ] **Step 4: Verify** — files + `npm test` + tsc + biome.
- [ ] **Step 5: Commit** — `fix(gitradar): holder records never count as active in trends/member/team views; doc lines included; Avg label`.

---

### Task 6: `dateDay` and `week` derived from the same instant

**Files:**
- Modify: `src/collector/git.ts:745-746`
- Test: `src/__tests__/git.test.ts`

- [ ] **Step 1: Failing test**

```ts
  it('active-day bit and week bucket agree for a commit near the UTC week boundary', async () => {
    // Sunday 2026-02-22 23:30 in UTC-8 = Monday 2026-02-23 07:30Z → ISO week 2026-W09, Monday bit
    spawnQueue.push('aaa111|alice@acme.com|Alice Johnson|2026-02-22T23:30:00-08:00|feat: x\n1\t0\tsrc/a.ts');
    const result = await scanRepo('/repos/frontend', { repoName: 'frontend', group: 'web', authorMap: makeAuthorMap(), recentHashes: new Set() });
    const [rec] = result.newRecords;
    expect(rec.week).toBe('2026-W09');
    expect(rec.activeDayMask).toBe(0b0000001); // Monday
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/git.test.ts` → mask is Sunday (`0b1000000`).
- [ ] **Step 3: Implement** — `const dateDay = new Date(commit.date).toISOString().slice(0, 10);` with a comment that `week` and `dateDay` must share the UTC calendar date (see `getISOWeek`). Keep the rework input `authorDate` untouched.
- [ ] **Step 4: Verify** — file + `npm test` + tsc + biome.
- [ ] **Step 5: Commit** — `fix(gitradar): active-day bit uses the same UTC date as the ISO week`.

---

### Task 7: Dedup cursor capacity

**Files:**
- Modify: `src/store/scan-state.ts:52-58`
- Test: `src/__tests__/scan-state.test.ts`

- [ ] **Step 1: Failing test** — `rotateHashes(existing(4999), ['new'])` keeps 5000 entries with `'new'` first; `rotateHashes(existing(5000), ['new'])` drops the oldest.
- [ ] **Step 2: Run to verify failure** (current cap 500).
- [ ] **Step 3: Implement** — `maxSize: number = 5000` with a doc comment: "Must exceed the number of commits a repo can receive inside the 1-day re-scan overlap (`since = lastScanDate − 1d`); below that, commits beyond the cap are re-counted. 5000 × 40 chars ≈ 200 KB per repo in scan_state." Update any test asserting 500.
- [ ] **Step 4: Verify**; **Step 5: Commit** — `fix(gitradar): dedup cursor holds 5000 hashes so busy repos do not double-count`.

---

### Task 8: Enrichment rename (`median_cycle_hrs`, `prs_reviewed_touched`) and churn retirement

**Files:**
- Modify: `src/types/schema.ts` (`ProductivityExtensionsSchema`, settings `churn_max_commits` removed), `src/collector/github.ts` (`GitHubMetrics` field names), `src/store/sqlite-store.ts` (enrichments table, migration v6 `RENAME COLUMN`, load/save mappers), `src/engine/gitradar-engine.ts` (enrich: remove churn pass, `skipChurn`/`deepChurn`), `src/commands/enrich.ts`, `src/cli.ts` (`--skip-churn`/`--deep-churn` removed), `src/commands/export-data.ts` (headers), `src/views/components/contribution-section.ts` (churn column removed; rename fields), `src/ui/grouped-hbar-chart.ts` (churn column removed), `src/aggregator/scorecard.ts` (`cycleHrs` ← `median_cycle_hrs`; `reviews` metric → key stays `reviews`, label `PRs rev'd`, reads `prs_reviewed_touched`), `src/demo.ts` (if it fabricates enrichments), `src/collector/git.ts` (delete `calculateChurnRate`, `calculateFastChurnRate`, `parseChurnLog`, `sampleEvenly` if unused elsewhere), docs.
- Test: `src/__tests__/schema.test.ts`, `src/__tests__/github.test.ts`, `src/__tests__/sqlite-scorecard.test.ts` (bun migration case), `src/__tests__/export-data.test.ts`, `src/__tests__/scorecard.test.ts`, `src/__tests__/contribution-section.test.ts`, `src/__tests__/git.test.ts` (delete churn tests), `src/__tests__/cli.test.ts`

**Interfaces:**
- Produces: `ProductivityExtensions = { prs_opened, prs_merged, median_cycle_hrs, prs_reviewed_touched, churn_rate_pct /* retired: always 0, not shown */, pr_feature, pr_fix, pr_bugfix, pr_chore, pr_hotfix, pr_other }`. SQLite `enrichments` columns renamed via migration v6: `ALTER TABLE enrichments RENAME COLUMN avg_cycle_hrs TO median_cycle_hrs` and `… reviews_given TO prs_reviewed_touched` (guarded by `PRAGMA table_info`). CSV headers `median_cycle_hrs`, `prs_reviewed_touched`; `churn_rate_pct` header removed. `EnrichOptions` loses `skipChurn`/`deepChurn`; settings lose `churn_max_commits` (keep `churn_window_days`/`churn_concurrency` — the rework pass uses them; rename is NOT done in this wave).

- [ ] **Step 1: Failing tests**

```ts
// schema.test.ts
it('ProductivityExtensions uses median_cycle_hrs and prs_reviewed_touched', () => {
  const e = ProductivityExtensionsSchema.parse({ median_cycle_hrs: 4.5, prs_reviewed_touched: 2 });
  expect(e.median_cycle_hrs).toBe(4.5); expect(e.prs_reviewed_touched).toBe(2);
  expect((e as Record<string, unknown>).avg_cycle_hrs).toBeUndefined();
});
// sqlite-scorecard.test.ts (bun) — legacy enrichments table with avg_cycle_hrs/reviews_given + one row → open store → loadEnrichmentsSQL() returns the row under the new names with the same values.
// export-data.test.ts — header contains median_cycle_hrs and prs_reviewed_touched, not avg_cycle_hrs / reviews_given / churn_rate_pct.
// scorecard.test.ts — existing enrichment fixtures renamed; cycleHrs still 20; reviews still 6; METRICS entry for 'reviews' has label "PRs rev'd".
// contribution-section.test.ts — rendered Lines detail layer has no 'churn' header.
// cli.test.ts — `enrich --help` no longer lists --skip-churn/--deep-churn (if the file builds the real program; otherwise assert EnrichOptions type via a compile-time `satisfies`).
```

- [ ] **Step 2: Run to verify failure** — the touched files.

- [ ] **Step 3: Implement** (in this order to keep tsc guiding you): schema → github.ts → store (+migration) → engine/enrich/cli → export → views/chart → scorecard → demo → delete churn code + tests → docs (`docs/feature-overview.md` §8 enrichment table and the `churn` mention in §2 Columns; README "GitHub enrichment" row: "PR metrics, median cycle time, PRs reviewed"). Add a one-paragraph note in `docs/feature-overview.md` §8: "`prs_reviewed_touched` counts PRs the member has reviewed that received any update in the week — it is not a count of review submissions."

Migration:

```ts
function migrateEnrichmentRenames(db: Database): void {
  const cols = new Set((db.prepare('PRAGMA table_info(enrichments)').all() as Array<{ name: string }>).map((c) => c.name));
  if (cols.has('avg_cycle_hrs') && !cols.has('median_cycle_hrs')) db.exec('ALTER TABLE enrichments RENAME COLUMN avg_cycle_hrs TO median_cycle_hrs;');
  if (cols.has('reviews_given') && !cols.has('prs_reviewed_touched')) db.exec('ALTER TABLE enrichments RENAME COLUMN reviews_given TO prs_reviewed_touched;');
}
```

Update the `CREATE TABLE IF NOT EXISTS enrichments` DDL to the new names; call the migration after `migrateScorecardColumns`. The GitHub API cache files (`getCacheDir()/gh_*.json`) still hold the old keys — in `readCache`, map `avg_cycle_hrs`→`median_cycle_hrs` and `reviews_given`→`prs_reviewed_touched` when present (one-line normalisation) so cached data isn't silently zeroed.

- [ ] **Step 4: Verify** — `npm test && npx tsc --noEmit` + biome. Grep: `grep -rn "avg_cycle_hrs\|reviews_given\|churnRatePct\|calculateChurnRate" src` returns only the migration and the cache normaliser.
- [ ] **Step 5: Commit** — `refactor(gitradar)!: rename enrichment fields to median_cycle_hrs / prs_reviewed_touched and retire churn` (body: CSV header change; `--skip-churn`/`--deep-churn` removed; `churn_max_commits` setting removed).

---

### Task 9: CLI/config truths — `repos:` ignored, `repos.yml` zod detail, `--prune` weeks, corrupt-DB message, `view trends --no-scan`

**Files:**
- Modify: `src/config/loader.ts:16-73`, `src/config/repos-registry.ts:47-52`, `src/cli.ts` (`--prune`, `view trends`, fatal handler), `src/engine/gitradar-engine.ts` (`handlePrune`, `RunOptions.skipScan`), `src/commands/run-main.ts`, `src/store/sqlite-store.ts:32-42` (`getDB`)
- Test: `src/__tests__/loader.test.ts`, `src/__tests__/repos-registry.test.ts`, `src/__tests__/cli.test.ts`, `src/__tests__/sqlite-scorecard.test.ts` (bun: corrupt file case)

**Interfaces:**
- Produces: `loadConfig()` ignores a `repos:` key in `config.yml` and prints once: `config.yml: "repos:" is ignored — manage repos with "gitradar repo add" (workspace registry)`; `ConfigSchema` keeps the `repos` field (runtime shape filled from the registry) but `loader.ts` sets it to `[]` regardless of the YAML. `RunOptions.skipScan?: boolean` — when true `runMain` skips `scan()` and `enrich()`. `--prune <weeks>` (global) → `handlePrune(weeks: number)` prunes records older than N weeks, message `Pruned N records older than W weeks.` `getDB()` wraps the open + schema in try/catch and rethrows `new Error('GitRadar database could not be opened (<path>): <reason>. If it is corrupt, run "gitradar --reset".')`.

- [ ] **Step 1: Failing tests**

```ts
// loader.test.ts
it('ignores config.yml repos: with a one-line warning', async () => {
  // write a temp config.yml with repos: [{ path: /x }] and orgs: []
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const cfg = await loadConfig(tmpPath);
  expect(cfg.repos).toEqual([]);
  expect(warn.mock.calls.flat().join(' ')).toMatch(/"repos:" is ignored/);
});
// repos-registry.test.ts
it('surfaces zod issue paths for an invalid repos.yml', () => {
  // write repos.yml with workspaces: { ws: { repos: [{ name: 5 }] } }
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => loadReposRegistry(path)).toThrow();
  expect(err.mock.calls.flat().join(' ')).toMatch(/workspaces\.ws\.repos\.0\.name/);
});
// cli.test.ts — build the program as the file does and assert: `--prune <weeks>` help text; `view trends` passes skipScan: true to runMain (mock runMain).
// sqlite-scorecard.test.ts (bun) — write garbage bytes to <GITRADAR_HOME>/data/gitradar.db; expect(() => store.getDB()).toThrow(/could not be opened .* gitradar --reset/);
```

- [ ] **Step 2: Run to verify failure** — the four files.

- [ ] **Step 3: Implement**

`loader.ts`: after parsing, `if (Array.isArray(raw.repos) && raw.repos.length > 0) console.warn('config.yml: "repos:" is ignored — manage repos with "gitradar repo add" (workspace registry)');` and `config.repos = [];` remove the path-resolution loop for `config.repos` (it now has nothing to resolve; keep `expandTilde` for other paths if used). `repos-registry.ts`: in the catch, if `err instanceof ZodError`, print each `issue.path.join('.') + ': ' + issue.message` before rethrowing. `cli.ts`: `.option('--prune <weeks>', 'Remove records older than N weeks', parseInt)`; `view trends` action → `runMain({ ...globals(), initialView: 'trends', skipScan: true })` and description `'Open the Trends screen using already-scanned data (interactive)'`; fatal handler prints `err.message` only (stack only when `GITRADAR_DEBUG` is set). `gitradar-engine.ts`: `handlePrune(weeks)` uses `getLastNWeeks(weeks + 1, getCurrentWeek())[0]` as the cutoff; `RunOptions.skipScan`; `run-main.ts`: `if (!opts.skipScan) { await engine.scan(opts); if (!opts.skipEnrich) await engine.enrich(...); }`. `sqlite-store.ts` `getDB`: wrap in try/catch as specified (close and null `_db` on failure).

Docs touched in this task: README `--prune` line → weeks; `docs/feature-overview.md` §1 "View Commands": move `view trends` under a new "Interactive screens" sub-heading with the no-scan note; §13 Configuration: delete the `repos:` block and add the sentence "Repos are managed through the workspace registry (`gitradar repo add`), never in `config.yml`."

- [ ] **Step 4: Verify** — files + `npm test` + tsc + biome. Manual: `GITRADAR_HOME=$(mktemp -d) bun src/cli.ts view trends` must NOT print any "Scan" lines before the screen (Ctrl-C to exit).
- [ ] **Step 5: Commit** — `fix(gitradar): config.yml repos is ignored, repos.yml errors show paths, --prune in weeks, friendly DB error, view trends skips scanning`.

---

### Task 10: Dashboard truths — segment menu percentages, `H` default, Top Performers signpost

**Files:**
- Modify: `src/views/dashboard.ts:416,712-735`, `src/views/components/top-performers-section.ts` (title), `src/types/schema.ts` (derive `.default()` from `DEFAULT_SETTINGS`)
- Test: `src/__tests__/views.test.ts`, `src/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `buildSegmentMenuLines(excluded: Set<Segment>, high: number, low: number): string[]` exported from `dashboard.ts` (pure; used by the `S` menu). `initialHideUnassigned(ctx: ViewContext): boolean` exported from `dashboard.ts` — `true` only when at least one author is assigned (any `config.orgs[].teams[].members[]` entry, or any registry author with `org` set); otherwise `false` so a fresh install is not empty. `DEFAULT_SETTINGS` is declared BEFORE `ConfigSchema` and the settings object's `.default(...)` is `DEFAULT_SETTINGS` (single source).

- [ ] **Step 1: Failing tests**

```ts
// views.test.ts
it('segment menu reflects configured thresholds', () => {
  const lines = buildSegmentMenuLines(new Set(), 10, 30).map(stripAnsi).join('\n');
  expect(lines).toMatch(/High \(top 10%\)/); expect(lines).toMatch(/Middle \(60%\)/); expect(lines).toMatch(/Low \(bottom 30%\)/);
});
it('hide-unassigned defaults off when nobody is assigned', () => {
  expect(initialHideUnassigned(ctxWith({ orgs: [] }, { authors: {} }))).toBe(false);
  expect(initialHideUnassigned(ctxWith({ orgs: [orgWithOneMember] }, { authors: {} }))).toBe(true);
});
// schema.test.ts
it('settings default object is DEFAULT_SETTINGS itself', () => {
  expect(ConfigSchema.parse({}).settings).toEqual(DEFAULT_SETTINGS);
});
```

- [ ] **Step 2: Run to verify failure**.
- [ ] **Step 3: Implement** — menu lines computed from `ctx.config.settings.segment_high_pct`/`segment_low_pct` (middle = `100 − high − low`); `let contribHideUnassigned = initialHideUnassigned(ctx);`; `schema.ts`: move `DEFAULT_SETTINGS` above `ConfigSchema`, `.default(DEFAULT_SETTINGS)`, delete the duplicated literal. Top Performers title becomes `Top Performers (by lines touched — see Scorecard [K] for normalised metrics)`; `docs/feature-overview.md` Tab P section gets one sentence pointing to Tab K and when to use which.
- [ ] **Step 4: Verify**; **Step 5: Commit** — `fix(gitradar): segment menu uses configured thresholds, hide-unassigned defaults off on fresh installs, single settings default`.

---

### Task 11: Packaging and documentation truth (Bun-only)

**Files:**
- Modify: `package.json` (`engines.bun`, remove `commander` dep, keep `bun` dep for the vendored binary but document), `README.md`, `docs/getting-started.md`, `docs/executive-overview.md`, `docs/feature-overview.md`, `docs/architecture.md`, `docs/roadmap.md` (tick wave-1 items)
- Test: `src/__tests__/docs-truth.test.ts` (new, vitest)

**Interfaces:** none.

- [ ] **Step 1: Failing test** — a small doc-truth guard:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
describe('docs tell the truth', () => {
  it('README links resolve', () => {
    for (const m of read('README.md').matchAll(/\]\((docs\/[^)]+)\)/g)) expect(existsSync(join(root, m[1]))).toBe(true);
  });
  it('no doc claims Node/better-sqlite3 or dead commands', () => {
    const all = ['README.md', 'docs/getting-started.md', 'docs/executive-overview.md', 'docs/feature-overview.md'].map(read).join('\n');
    for (const bad of ['better-sqlite3', 'Node.js ≥ 20', 'gitradar data enrich', 'workspace use', 'repo add ~/code/my-project --name', 'max_scan_age_weeks', 'feature-tour.md'])
      expect(all, bad).not.toContain(bad);
  });
  it('package.json declares the Bun engine', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.engines?.bun).toMatch(/^>=1\./);
    expect(pkg.dependencies?.commander).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/docs-truth.test.ts`.
- [ ] **Step 3: Implement** — `package.json`: `"engines": { "bun": ">=1.3" }`, remove `commander`; README: Tech Stack → "TypeScript on **Bun** (`bun:sqlite`)", fix the Feature Tour link, replace the hard-coded test count with "see `npm test`", `--prune <weeks>`, remove `repos:` from the config example, add `--skip-rework` and `--force-scan` semantics; getting-started: Bun ≥ 1.3 prerequisite (`bun --version`), `gitradar enrich`, delete `workspace use`, `repo add` without `--name`, remove `max_scan_age_weeks`, add "Dashboard looks empty → press H or assign authors" troubleshooting; executive-overview: Bun, remove the test-count sentence; feature-overview: §8 enrichment table uses the new names, `--prune <weeks>`; architecture.md: tech stack + remove stale test count; `docs/roadmap.md`: tick every item this wave completed and note the ones explicitly deferred (reverts, co-authors, cherry-picks, Tier 3/4).
- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/docs-truth.test.ts && npm test && npx tsc --noEmit` + biome; `bun src/cli.ts --help` still works.
- [ ] **Step 5: Commit** — `docs(gitradar): Bun-only packaging and truthful docs; roadmap wave 1 ticked`.

---

## Final verification

- [ ] `npm test`, `npx tsc --noEmit`, `npx biome check apps/gitradar` (repo root) all clean.
- [ ] `grep -rn "avg_cycle_hrs\|reviews_given\|churn_rate_pct" src docs README.md` → only the migration, cache normaliser, and a "retired" note.
- [ ] Against real data (user-run, not in CI): `gitradar scan --force-scan` re-walks one workspace and the Scan complete line shows the same record count as a `--reset` scan; `gitradar view scorecard` still renders.
