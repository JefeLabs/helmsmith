# GitRadar Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-member Scorecard tab/CLI to GitRadar fed by two new git-only collection passes (merged-PR proxy, blame-based rework), with normalised, percentile-ranked, direction-aware metrics and an opt-in composite.

**Architecture:** Collection is a scan-integrated post-pass per repo over newly scanned commits, stored as additive columns on the existing `records` table. A pure aggregator (`aggregator/scorecard.ts`) turns records + enrichments into rows of `{value, baseline, deltaPct, percentile}` cells. A new dashboard tab and a `view scorecard` CLI render it.

**Tech Stack:** TypeScript (ESM), Node + Bun, `simple-git`/`spawn`, bun:sqlite, zod, commander, chalk, vitest (+ `bun test` for store suites), biome.

**Spec:** `docs/superpowers/specs/2026-08-22-gitradar-scorecard-design.md`

## Global Constraints

- Package: `apps/gitradar`. Run commands from that directory unless stated.
- Tests: `npx vitest run <file>` for vitest suites; `bun test <file>` for bun suites. Full: `npm test`. Typecheck: `npx tsc --noEmit`. Lint/format: `npx biome check --write .` (run from repo root: `npx biome check --write apps/gitradar`).
- Any test that opens the real store must set `process.env.GITRADAR_HOME` to a temp dir **and** run in its own `bun test` invocation (Bun's `mock.module` is process-global). Add new bun test files to the `test:bun` script as separate `&& bun test …` segments and to `vitest.config.ts` `exclude`.
- Record identity/metrics naming follows existing conventions: camelCase in TS (`prsMergedGit`), snake_case in SQLite/CSV (`prs_merged_git`).
- Commit messages: conventional (`feat(gitradar): …`), end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do not edit `Makefile` (user's uncommitted change lives there).
- Default values copied from the spec: `churn_window_days` 21 (reused as rework window), `scorecard_min_n` 8, `segment_min_n` 8, `bot_patterns` `["[bot]", "dependabot", "renovate", "github-actions"]`, `rework_enabled` true, tab key `k`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/schema.ts` (modify) | New settings keys, record fields `prsMergedGit/prSizes/reworkLines/reworkSelfLines`, scan-state `recentPrHashes`, `SCORECARD_METRIC_KEYS` |
| `src/store/sqlite-store.ts` (modify) | Migration v5 columns, row mapping, upsert merges (incl. JSON concat + scopes union fix), rollup fields, scan-state column |
| `src/aggregator/engine.ts` (modify) | `rollup()` sums/concats the four new fields |
| `src/aggregator/bots.ts` (new) | `isBotAuthor`, `excludeBots` |
| `src/aggregator/segments.ts` (modify) | `minN` guardrail |
| `src/collector/git.ts` (modify) | Export `makeEmptyRecord`; collect `ReworkInput`s during scan; `ScanResult.reworkInputs` |
| `src/collector/pr-proxy.ts` (new) | First-parent log parse, PR detection, default-branch resolution, `runPrProxy` |
| `src/collector/rework.ts` (new) | Diff-hunk + blame-porcelain parsers, `runRework` |
| `src/collector/index.ts` (modify) | Run both post-passes after each repo scan, merge records, rotate `recentPrHashes`, stats |
| `src/engine/gitradar-engine.ts`, `src/cli.ts` (modify) | `--skip-rework`, `view scorecard` |
| `src/aggregator/scorecard.ts` (new) | `METRICS`, `computeScorecard` |
| `src/views/components/scorecard-section.ts` (new) | Table rendering, hotkeys, sorting |
| `src/views/dashboard.ts` (modify) | 5th tab, state, keys |
| `src/commands/scorecard.ts` (new) | CLI command |
| `src/commands/export-data.ts`, `src/demo.ts`, docs (modify) | CSV columns, demo data, documentation |

---

### Task 1: Schema — settings, record fields, scan-state cursor

**Files:**
- Modify: `src/types/schema.ts`
- Test: `src/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `Config['settings']` gains `rework_enabled: boolean`, `scorecard_min_n: number`, `scorecard_weights?: Record<string, number>`, `bot_patterns: string[]`, `segment_min_n: number`. `UserWeekRepoRecord` gains optional `prsMergedGit?: number`, `prSizes?: number[]`, `reworkLines?: number`, `reworkSelfLines?: number`. `ScanState['repos'][x]` gains optional `recentPrHashes?: string[]`. Exported `SCORECARD_METRIC_KEYS` (readonly string tuple) and type `ScorecardMetricKey`.

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe('ConfigSchema')` and `describe('UserWeekRepoRecordSchema')` / `describe('ScanStateSchema')` blocks of `src/__tests__/schema.test.ts`)

```ts
// in describe('ConfigSchema')
it('defaults the scorecard / rework / bot settings', () => {
  const s = ConfigSchema.parse({}).settings;
  expect(s.rework_enabled).toBe(true);
  expect(s.scorecard_min_n).toBe(8);
  expect(s.segment_min_n).toBe(8);
  expect(s.scorecard_weights).toBeUndefined();
  expect(s.bot_patterns).toEqual(['[bot]', 'dependabot', 'renovate', 'github-actions']);
  expect(DEFAULT_SETTINGS.scorecard_min_n).toBe(8);
});

it('accepts scorecard_weights only for known metric keys with positive weights', () => {
  expect(
    ConfigSchema.parse({ settings: { scorecard_weights: { commitsPerWeek: 2, reworkPct: 1 } } })
      .settings.scorecard_weights,
  ).toEqual({ commitsPerWeek: 2, reworkPct: 1 });
  expect(() => ConfigSchema.parse({ settings: { scorecard_weights: { linesTouched: 1 } } })).toThrow();
  expect(() => ConfigSchema.parse({ settings: { scorecard_weights: { commitsPerWeek: 0 } } })).toThrow();
});

// in describe('UserWeekRepoRecordSchema')
it('accepts optional PR-proxy and rework fields', () => {
  const r = UserWeekRepoRecordSchema.parse(
    makeRecord({ prsMergedGit: 2, prSizes: [120, 40], reworkLines: 7, reworkSelfLines: 3 }),
  );
  expect(r.prsMergedGit).toBe(2);
  expect(r.prSizes).toEqual([120, 40]);
  expect(r.reworkLines).toBe(7);
  expect(r.reworkSelfLines).toBe(3);
  expect(UserWeekRepoRecordSchema.parse(makeRecord()).prSizes).toBeUndefined();
});

// in describe('ScanStateSchema')
it('accepts an optional recentPrHashes cursor per repo', () => {
  const parsed = ScanStateSchema.parse({
    version: 1,
    repos: {
      app: {
        lastHash: 'abc', lastScanDate: '2026-03-01T00:00:00Z', recentHashes: [], recordCount: 0,
        recentPrHashes: ['m1', 'm2'],
      },
    },
  });
  expect(parsed.repos.app.recentPrHashes).toEqual(['m1', 'm2']);
});
```

Add `ScanStateSchema` to the test file's import from `../types/schema.js` if it is not already imported.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/schema.test.ts`
Expected: the 4 new tests FAIL (`rework_enabled` undefined, weights not rejected, etc.).

- [ ] **Step 3: Implement in `src/types/schema.ts`**

Add near the top (after imports):

```ts
/** Metric keys the scorecard can compute; `settings.scorecard_weights` may only reference these. */
export const SCORECARD_METRIC_KEYS = [
  'commitsPerWeek', 'daysPerWeek', 'prsPerWeek',
  'prSizeP50', 'prSizeP75', 'cycleHrs',
  'reworkPct', 'fixToFeat', 'testPct', 'breaking',
  'reviews', 'reviewsPerPr', 'repos', 'scopes',
] as const;
export type ScorecardMetricKey = (typeof SCORECARD_METRIC_KEYS)[number];

const DEFAULT_BOT_PATTERNS = ['[bot]', 'dependabot', 'renovate', 'github-actions'];
```

Inside `settings: z.object({ … })`, after `auto_prune_weeks`:

```ts
      /** Run the blame-based rework pass after each scan. Default: true. */
      rework_enabled: z.boolean().optional().default(true),
      /** Minimum cohort size before the scorecard shows percentiles. Default: 8. */
      scorecard_min_n: z.number().int().min(1).optional().default(8),
      /** Opt-in composite: metricKey → positive weight. Absent = no score column. */
      scorecard_weights: z
        .record(z.string(), z.number().positive())
        .optional()
        .refine(
          (w) => !w || Object.keys(w).every((k) => (SCORECARD_METRIC_KEYS as readonly string[]).includes(k)),
          { message: `scorecard_weights keys must be one of: ${SCORECARD_METRIC_KEYS.join(', ')}` },
        ),
      /** Case-insensitive substrings identifying bot authors (name or email). */
      bot_patterns: z.array(z.string()).optional().default(DEFAULT_BOT_PATTERNS),
      /** Minimum cohort size before high/low segment labels are assigned. Default: 8. */
      segment_min_n: z.number().int().min(1).optional().default(8),
```

Add to the `.default({ … })` literal and to `DEFAULT_SETTINGS`:

```ts
      rework_enabled: true,
      scorecard_min_n: 8,
      bot_patterns: DEFAULT_BOT_PATTERNS,
      segment_min_n: 8,
```

In `UserWeekRepoRecordSchema` after `activeDayMask`:

```ts
  /** Merged PRs detected by the git-only first-parent proxy (see collector/pr-proxy.ts). */
  prsMergedGit: z.number().int().min(0).optional(),
  /** Size (ins+del, ignore-filtered) of each proxy-detected PR merged in this week. */
  prSizes: z.array(z.number().int().min(0)).optional(),
  /** Lines this member wrote within churn_window_days that were deleted this week (by anyone). */
  reworkLines: z.number().int().min(0).optional(),
  /** Subset of reworkLines deleted by the member themselves. */
  reworkSelfLines: z.number().int().min(0).optional(),
```

In `RepoScanStateSchema`:

```ts
  /** Dedup cursor for the first-parent PR proxy pass (separate from recentHashes). */
  recentPrHashes: z.array(z.string()).optional(),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/schema.test.ts && npx tsc --noEmit`
Expected: all pass; typecheck clean (if `DEFAULT_SETTINGS` typing complains about `scorecard_weights`, it is optional — no entry needed).

- [ ] **Step 5: Commit**

```bash
git add src/types/schema.ts src/__tests__/schema.test.ts
git commit -m "feat(gitradar): scorecard settings, record fields, PR-proxy scan cursor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Store — columns, merges, rollup fields, scan-state cursor

**Files:**
- Modify: `src/store/sqlite-store.ts` (schema ~L56-132, migrations ~L153-200, `recordToRow`/`rowToRecord`, both upserts, `RolledUp`, `queryRollup`, scan-state load/save/update)
- Modify: `src/aggregator/engine.ts` (`emptyRolledUp`, `rollup`)
- Test: `src/__tests__/sqlite-scorecard.test.ts` (new, bun), `src/__tests__/engine.test.ts`, `package.json` `test:bun`, `vitest.config.ts` exclude

**Interfaces:**
- Produces: `RolledUp` gains `prsMergedGit: number; prSizes: number[]; reworkLines: number; reworkSelfLines: number` (both `rollup()` and `queryRollup()`); `records` columns `prs_merged_git`, `pr_sizes`, `rework_lines`, `rework_self_lines`; `scan_state.recent_pr_hashes`; upsert of `scopes` becomes a set union.

- [ ] **Step 1: Write the failing bun tests** — create `src/__tests__/sqlite-scorecard.test.ts`

```ts
/** Real-store tests for PR-proxy / rework columns (bun:sqlite, sandboxed via GITRADAR_HOME). */
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UserWeekRepoRecord } from '../types/schema.js';

const store = await import('../store/sqlite-store.js');

function makeRecord(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: 'Alice', email: 'alice@example.com', org: 'Acme', orgType: 'core',
    team: 'Frontend', tag: 'default', week: '2026-W10', repo: 'web', group: 'default',
    commits: 2, activeDays: 1, scopes: [],
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 2 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

describe('scorecard columns in the SQLite store', () => {
  let tmpHome: string;
  let dataDir: string;
  const originalOverride = process.env.GITRADAR_HOME;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'gitradar-scorecard-'));
    dataDir = join(tmpHome, 'data');
    await mkdir(dataDir, { recursive: true });
    process.env.GITRADAR_HOME = tmpHome;
    expect(store.getSQLitePath()).toBe(join(dataDir, 'gitradar.db'));
  });

  afterEach(async () => {
    store.closeDB();
    if (originalOverride === undefined) delete process.env.GITRADAR_HOME;
    else process.env.GITRADAR_HOME = originalOverride;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('round-trips the four new fields', () => {
    store.upsertRecords([makeRecord({ prsMergedGit: 2, prSizes: [120, 40], reworkLines: 7, reworkSelfLines: 3 })]);
    const [row] = store.queryRecords({});
    expect(row.prsMergedGit).toBe(2);
    expect(row.prSizes).toEqual([120, 40]);
    expect(row.reworkLines).toBe(7);
    expect(row.reworkSelfLines).toBe(3);
  });

  it('reads legacy rows as zero/empty for the new fields', () => {
    store.upsertRecords([makeRecord()]);
    const [row] = store.queryRecords({});
    expect(row.prsMergedGit).toBe(0);
    expect(row.prSizes).toEqual([]);
    expect(row.reworkLines).toBe(0);
  });

  it('upsert merge adds counters, concatenates pr_sizes and unions scopes', () => {
    store.upsertRecords([makeRecord({ prsMergedGit: 1, prSizes: [100], reworkLines: 2, reworkSelfLines: 1, scopes: ['auth'] })]);
    store.upsertRecords([makeRecord({ commits: 0, prsMergedGit: 2, prSizes: [30, 70], reworkLines: 5, reworkSelfLines: 0, scopes: ['api', 'auth'] })]);
    const [row] = store.queryRecords({});
    expect(row.commits).toBe(2);
    expect(row.prsMergedGit).toBe(3);
    expect(row.prSizes).toEqual([100, 30, 70]);
    expect(row.reworkLines).toBe(7);
    expect(row.reworkSelfLines).toBe(1);
    expect([...(row.scopes ?? [])].sort()).toEqual(['api', 'auth']);
  });

  it('queryRollup sums counters and concatenates pr_sizes per group', () => {
    store.upsertRecords([
      makeRecord({ repo: 'web', prsMergedGit: 1, prSizes: [100], reworkLines: 2, reworkSelfLines: 1 }),
      makeRecord({ repo: 'api', prsMergedGit: 2, prSizes: [30, 70], reworkLines: 5, reworkSelfLines: 2 }),
      makeRecord({ member: 'Bob', repo: 'api', prsMergedGit: 1, prSizes: [9] }),
    ]);
    const alice = store.queryRollup({}, 'member').get('Alice')!;
    expect(alice.prsMergedGit).toBe(3);
    expect([...alice.prSizes].sort((a, b) => a - b)).toEqual([30, 70, 100]);
    expect(alice.reworkLines).toBe(7);
    expect(alice.reworkSelfLines).toBe(3);
    const all = store.queryRollup({}, 'all').get('all')!;
    expect(all.prsMergedGit).toBe(4);
    expect(all.prSizes).toHaveLength(4);
  });

  it('round-trips recentPrHashes through scan state', () => {
    store.saveScanStateSQL({
      version: 1,
      repos: { web: { lastHash: 'a', lastScanDate: '2026-03-01T00:00:00Z', recentHashes: ['a'], recordCount: 1, recentPrHashes: ['m1'] } },
    });
    expect(store.loadScanStateSQL().repos.web.recentPrHashes).toEqual(['m1']);
    store.updateRepoScanStateSQL('web', { lastHash: 'b', lastScanDate: '2026-03-02T00:00:00Z', recentHashes: ['b', 'a'], recordCount: 2, recentPrHashes: ['m2', 'm1'] });
    expect(store.loadScanStateSQL().repos.web.recentPrHashes).toEqual(['m2', 'm1']);
  });

  it('migrates a pre-existing database that lacks the new columns', () => {
    const legacy = new Database(join(dataDir, 'gitradar.db'), { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE records (
        member TEXT NOT NULL, email TEXT NOT NULL, org TEXT NOT NULL, org_type TEXT NOT NULL,
        team TEXT NOT NULL, tag TEXT NOT NULL, week TEXT NOT NULL, repo TEXT NOT NULL, grp TEXT NOT NULL,
        commits INTEGER NOT NULL DEFAULT 0, active_days INTEGER NOT NULL DEFAULT 0, active_day_mask INTEGER NOT NULL DEFAULT 0,
        intent_feat INTEGER NOT NULL DEFAULT 0, intent_fix INTEGER NOT NULL DEFAULT 0, intent_refactor INTEGER NOT NULL DEFAULT 0,
        intent_docs INTEGER NOT NULL DEFAULT 0, intent_test INTEGER NOT NULL DEFAULT 0, intent_chore INTEGER NOT NULL DEFAULT 0,
        intent_other INTEGER NOT NULL DEFAULT 0,
        app_files INTEGER NOT NULL DEFAULT 0, app_files_added INTEGER NOT NULL DEFAULT 0, app_files_deleted INTEGER NOT NULL DEFAULT 0,
        app_ins INTEGER NOT NULL DEFAULT 0, app_del INTEGER NOT NULL DEFAULT 0,
        test_files INTEGER NOT NULL DEFAULT 0, test_files_added INTEGER NOT NULL DEFAULT 0, test_files_deleted INTEGER NOT NULL DEFAULT 0,
        test_ins INTEGER NOT NULL DEFAULT 0, test_del INTEGER NOT NULL DEFAULT 0,
        config_files INTEGER NOT NULL DEFAULT 0, config_files_added INTEGER NOT NULL DEFAULT 0, config_files_deleted INTEGER NOT NULL DEFAULT 0,
        config_ins INTEGER NOT NULL DEFAULT 0, config_del INTEGER NOT NULL DEFAULT 0,
        storybook_files INTEGER NOT NULL DEFAULT 0, storybook_files_added INTEGER NOT NULL DEFAULT 0, storybook_files_deleted INTEGER NOT NULL DEFAULT 0,
        storybook_ins INTEGER NOT NULL DEFAULT 0, storybook_del INTEGER NOT NULL DEFAULT 0,
        doc_files INTEGER NOT NULL DEFAULT 0, doc_files_added INTEGER NOT NULL DEFAULT 0, doc_files_deleted INTEGER NOT NULL DEFAULT 0,
        doc_ins INTEGER NOT NULL DEFAULT 0, doc_del INTEGER NOT NULL DEFAULT 0,
        breaking_changes INTEGER NOT NULL DEFAULT 0, scopes TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (member, week, repo)
      );
      CREATE TABLE scan_state (
        repo TEXT PRIMARY KEY, last_hash TEXT NOT NULL, last_scan_date TEXT NOT NULL,
        recent_hashes TEXT NOT NULL DEFAULT '[]', record_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO records (member, email, org, org_type, team, tag, week, repo, grp, commits)
      VALUES ('Alice', 'a@x', 'Acme', 'core', 'FE', 'default', '2026-W10', 'web', 'default', 4);
      INSERT INTO scan_state (repo, last_hash, last_scan_date) VALUES ('web', 'a', '2026-03-01T00:00:00Z');
    `);
    legacy.close();

    const [row] = store.queryRecords({});
    expect(row.commits).toBe(4);
    expect(row.prsMergedGit).toBe(0);
    expect(row.prSizes).toEqual([]);
    expect(store.loadScanStateSQL().repos.web.recentPrHashes).toEqual([]);
    store.upsertRecords([makeRecord({ repo: 'api', prsMergedGit: 1, prSizes: [5] })]);
    expect(store.queryRecords({ repo: 'api' })[0].prSizes).toEqual([5]);
  });
});
```

Append to `src/__tests__/engine.test.ts` inside `describe('rollup')`:

```ts
  it('sums PR-proxy and rework counters and concatenates prSizes', () => {
    const records = [
      makeRecord({ member: 'alice', repo: 'web-app', prsMergedGit: 1, prSizes: [100], reworkLines: 2, reworkSelfLines: 1 }),
      makeRecord({ member: 'alice', repo: 'api', prsMergedGit: 2, prSizes: [30, 70], reworkLines: 5, reworkSelfLines: 0 }),
      makeRecord({ member: 'bob', repo: 'api' }), // legacy record: fields absent
    ];
    const acme = rollup(records, (r) => r.org).get('Acme')!;
    expect(acme.prsMergedGit).toBe(3);
    expect(acme.prSizes).toEqual([100, 30, 70]);
    expect(acme.reworkLines).toBe(7);
    expect(acme.reworkSelfLines).toBe(1);
  });
```

Register the bun file: in `package.json` change `test:bun` to
`"bun test src/__tests__/sqlite-store.test.ts src/__tests__/functional.test.ts && bun test src/__tests__/sqlite-active-days.test.ts && bun test src/__tests__/sqlite-scorecard.test.ts"`
and add `'src/__tests__/sqlite-scorecard.test.ts'` to the `exclude` list in `vitest.config.ts`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/__tests__/sqlite-scorecard.test.ts; npx vitest run src/__tests__/engine.test.ts`
Expected: bun — 6 fail (undefined fields / missing columns); vitest — 1 fail (`prsMergedGit` undefined).

- [ ] **Step 3: Implement store changes in `src/store/sqlite-store.ts`**

(a) `CREATE TABLE IF NOT EXISTS records`: after `scopes TEXT NOT NULL DEFAULT '[]',` add

```sql
      prs_merged_git INTEGER NOT NULL DEFAULT 0,
      pr_sizes TEXT NOT NULL DEFAULT '[]',
      rework_lines INTEGER NOT NULL DEFAULT 0,
      rework_self_lines INTEGER NOT NULL DEFAULT 0,
```

and in `CREATE TABLE IF NOT EXISTS scan_state` add `recent_pr_hashes TEXT NOT NULL DEFAULT '[]'` after `record_count`.

(b) Migrations — after `migrateRecordsActiveDayMask(db);` call `migrateScorecardColumns(db);` and add:

```ts
/** Add PR-proxy / rework columns and the PR scan cursor if missing (migration v5). */
function migrateScorecardColumns(db: Database): void {
  const recCols = new Set(
    (db.prepare('PRAGMA table_info(records)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  const add = (col: string, ddl: string) => {
    if (!recCols.has(col)) db.exec(`ALTER TABLE records ADD COLUMN ${col} ${ddl};`);
  };
  add('prs_merged_git', 'INTEGER NOT NULL DEFAULT 0');
  add('pr_sizes', "TEXT NOT NULL DEFAULT '[]'");
  add('rework_lines', 'INTEGER NOT NULL DEFAULT 0');
  add('rework_self_lines', 'INTEGER NOT NULL DEFAULT 0');

  const ssCols = (db.prepare('PRAGMA table_info(scan_state)').all() as Array<{ name: string }>).map((c) => c.name);
  if (!ssCols.includes('recent_pr_hashes')) {
    db.exec("ALTER TABLE scan_state ADD COLUMN recent_pr_hashes TEXT NOT NULL DEFAULT '[]';");
  }
}
```

(c) `recordToRow`: after `scopes: JSON.stringify(r.scopes ?? []),` add

```ts
    prs_merged_git: r.prsMergedGit ?? 0,
    pr_sizes: JSON.stringify(r.prSizes ?? []),
    rework_lines: r.reworkLines ?? 0,
    rework_self_lines: r.reworkSelfLines ?? 0,
```

`rowToRecord`: after `scopes: JSON.parse(...)`, add

```ts
    prsMergedGit: (row.prs_merged_git as number) ?? 0,
    prSizes: JSON.parse((row.pr_sizes as string) || '[]') as number[],
    reworkLines: (row.rework_lines as number) ?? 0,
    reworkSelfLines: (row.rework_self_lines as number) ?? 0,
```

(d) Both record upserts (`saveCommitsDataSQL` and `upsertRecords`): in the column list append `, prs_merged_git, pr_sizes, rework_lines, rework_self_lines` after `breaking_changes, scopes`; in VALUES append `, @prs_merged_git, @pr_sizes, @rework_lines, @rework_self_lines`; replace the SET line `scopes = excluded.scopes` with:

```sql
      scopes = (SELECT json_group_array(value) FROM (
        SELECT value FROM json_each(records.scopes)
        UNION SELECT value FROM json_each(excluded.scopes))),
      prs_merged_git = prs_merged_git + excluded.prs_merged_git,
      pr_sizes = (SELECT json_group_array(value) FROM (
        SELECT value FROM json_each(records.pr_sizes)
        UNION ALL SELECT value FROM json_each(excluded.pr_sizes))),
      rework_lines = rework_lines + excluded.rework_lines,
      rework_self_lines = rework_self_lines + excluded.rework_self_lines
```

Extract the shared tail into a `const RECORD_MERGE_TAIL_SQL = \`…\`` used by both statements so they cannot drift.

If bun:sqlite rejects `excluded.` inside the sub-selects (older SQLite builds scope `excluded` only to the top-level SET expression), fall back to merging in JS inside the same transaction: `SELECT scopes, pr_sizes FROM records WHERE member=@member AND week=@week AND repo=@repo`, union/concat in TypeScript, and bind the merged JSON as `@scopes` / `@pr_sizes` with plain `scopes = excluded.scopes, pr_sizes = excluded.pr_sizes`. The bun tests in Step 1 are the acceptance criterion either way.

(e) `RolledUp` interface: add `prsMergedGit: number; prSizes: number[]; reworkLines: number; reworkSelfLines: number;`. In `queryRollup` main SELECT add `SUM(prs_merged_git) as prs_merged_git, SUM(rework_lines) as rework_lines, SUM(rework_self_lines) as rework_self_lines,`. Add a second query (next to the active-days one):

```ts
  const prSizesSql = `
    SELECT ${groupCol} as group_key, json_group_array(je.value) as sizes
    FROM records, json_each(records.pr_sizes) AS je
    ${where}
    ${groupByClause}
  `;
  const prSizesByKey = new Map<string, number[]>();
  for (const row of db.prepare(prSizesSql).all(params) as Array<Record<string, unknown>>) {
    prSizesByKey.set(String(row.group_key), JSON.parse((row.sizes as string) || '[]') as number[]);
  }
```

and in `result.set(key, { … })` add

```ts
      prsMergedGit: (row.prs_merged_git as number) ?? 0,
      prSizes: prSizesByKey.get(key) ?? [],
      reworkLines: (row.rework_lines as number) ?? 0,
      reworkSelfLines: (row.rework_self_lines as number) ?? 0,
```

(f) Scan state: `loadScanStateSQL` row type gains `recent_pr_hashes: string`; map `recentPrHashes: JSON.parse(row.recent_pr_hashes || '[]') as string[]`. Both save statements: add column `recent_pr_hashes` + `@recent_pr_hashes` + `recent_pr_hashes = excluded.recent_pr_hashes`; bind `recent_pr_hashes: JSON.stringify(rs.recentPrHashes ?? [])`.

- [ ] **Step 4: Implement `rollup()` in `src/aggregator/engine.ts`**

In `emptyRolledUp()` add `prsMergedGit: 0, prSizes: [], reworkLines: 0, reworkSelfLines: 0,`. In the loop after `agg.breakingChanges += …` add:

```ts
    agg.prsMergedGit += r.prsMergedGit ?? 0;
    if (r.prSizes?.length) agg.prSizes.push(...r.prSizes);
    agg.reworkLines += r.reworkLines ?? 0;
    agg.reworkSelfLines += r.reworkSelfLines ?? 0;
```

- [ ] **Step 5: Run tests, typecheck, format**

Run: `bun test src/__tests__/sqlite-scorecard.test.ts && npx vitest run src/__tests__/engine.test.ts src/__tests__/sqlite-store.test.ts; npm test; npx tsc --noEmit; (cd ../.. && npx biome check --write apps/gitradar)`
Expected: all green. (Any other test constructing a `RolledUp` literal — search `activeMembers:` in `src/__tests__` — needs the four new fields added.)

- [ ] **Step 6: Commit**

```bash
git add src/store/sqlite-store.ts src/aggregator/engine.ts src/__tests__/sqlite-scorecard.test.ts src/__tests__/engine.test.ts package.json vitest.config.ts
git commit -m "feat(gitradar): store PR-proxy/rework columns, union scopes on merge, PR scan cursor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Bots helper + segment min-N guardrail

**Files:**
- Create: `src/aggregator/bots.ts`
- Modify: `src/aggregator/segments.ts`; callers `src/views/components/contribution-section.ts` (~L1108, L1146, L1170), `src/commands/leaderboard.ts` (~L55), `src/commands/contributions.ts` (~L419), `src/commands/export-data.ts` (~L172)
- Test: `src/__tests__/bots.test.ts` (new), `src/__tests__/segments.test.ts`

**Interfaces:**
- Produces: `isBotAuthor(name: string, email: string, patterns: string[]): boolean`; `excludeBots<T extends {member: string; email: string}>(records: T[], patterns: string[]): T[]`; `calculateSegments(memberTotals, thresholds?, minN = 8)`.

- [ ] **Step 1: Write failing tests** — create `src/__tests__/bots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { excludeBots, isBotAuthor } from '../aggregator/bots.js';

const PATTERNS = ['[bot]', 'dependabot', 'renovate', 'github-actions'];

describe('isBotAuthor', () => {
  it('matches case-insensitively on name or email', () => {
    expect(isBotAuthor('dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com', PATTERNS)).toBe(true);
    expect(isBotAuthor('Renovate Bot', 'bot@renovateapp.com', PATTERNS)).toBe(true);
    expect(isBotAuthor('GitHub Actions', 'github-actions@github.com', PATTERNS)).toBe(true);
    expect(isBotAuthor('Alice Chen', 'alice@co.com', PATTERNS)).toBe(false);
  });
  it('treats an empty pattern list as "no bots"', () => {
    expect(isBotAuthor('dependabot[bot]', 'x@y', [])).toBe(false);
  });
});

describe('excludeBots', () => {
  it('drops records whose member or email matches', () => {
    const recs = [
      { member: 'Alice', email: 'alice@co.com' },
      { member: 'dependabot[bot]', email: 'd@x' },
      { member: 'CI', email: 'github-actions@github.com' },
    ];
    expect(excludeBots(recs, PATTERNS).map((r) => r.member)).toEqual(['Alice']);
  });
});
```

Rewrite the small-N tests in `src/__tests__/segments.test.ts` (`single member`, `2 members`, `3 members`, `4 members`, `exactly 5 members`) to the new policy and add a `minN` test:

```ts
  it('assigns everyone to middle when the cohort is smaller than minN (default 8)', () => {
    const totals = new Map([['a', 100], ['b', 50], ['c', 10], ['d', 0]]);
    const seg = calculateSegments(totals);
    expect([...seg.values()].every((s) => s === 'middle')).toBe(true);
  });

  it('labels high/low once the cohort reaches minN', () => {
    const totals = new Map(Array.from({ length: 8 }, (_, i) => [`m${i}`, (8 - i) * 10] as [string, number]));
    const seg = calculateSegments(totals);
    expect(seg.get('m0')).toBe('high');
    expect(seg.get('m1')).toBe('high');
    expect(seg.get('m7')).toBe('low');
    expect(seg.get('m3')).toBe('middle');
  });

  it('respects a custom minN', () => {
    const totals = new Map([['a', 100], ['b', 50], ['c', 10]]);
    expect(calculateSegments(totals, undefined, 3).get('a')).toBe('high');
    expect(calculateSegments(totals, undefined, 3).get('c')).toBe('low');
  });
```

Delete the tests named `assigns single member as high (non-zero)`, `assigns single member with 0 as low`, `handles 2 members…`, `handles 3 members (N<5)…`, `handles 4 members (N<5)…`; change `handles exactly 5 members with 20/60/20 split` to call `calculateSegments(totals, undefined, 5)`. Keep `zero-value members are always low` tests but give them ≥ 8 members (or pass `minN` = their size).

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/__tests__/bots.test.ts src/__tests__/segments.test.ts`
Expected: bots tests fail to import; new segment tests fail (3 members currently get high/low).

- [ ] **Step 3: Implement**

`src/aggregator/bots.ts`:

```ts
/**
 * Bot-author detection. Bots (dependabot, renovate, CI) inflate volume metrics and
 * must never appear in scorecards or segment cohorts.
 */
export function isBotAuthor(name: string, email: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const hay = `${name}\n${email}`.toLowerCase();
  return patterns.some((p) => p && hay.includes(p.toLowerCase()));
}

export function excludeBots<T extends { member: string; email: string }>(
  records: T[],
  patterns: string[],
): T[] {
  if (patterns.length === 0) return records;
  return records.filter((r) => !isBotAuthor(r.member, r.email, patterns));
}
```

`src/aggregator/segments.ts` — new signature and policy:

```ts
export function calculateSegments(
  memberTotals: Map<string, number>,
  thresholds: SegmentThresholds = { high: 20, low: 20 },
  minN = 8,
): Map<string, Segment> {
  const result = new Map<string, Segment>();
  const entries = [...memberTotals.entries()];
  const n = entries.length;
  if (n === 0) return result;

  // Too few people for a percentile split to mean anything: no labels at all.
  if (n < minN) {
    for (const [name] of entries) result.set(name, 'middle');
    return result;
  }

  entries.sort((a, b) => b[1] - a[1]);
  const highCount = Math.ceil(n * (thresholds.high / 100));
  const lowCount = Math.ceil(n * (thresholds.low / 100));
  for (let i = 0; i < entries.length; i++) {
    const [name, value] = entries[i];
    if (value === 0) result.set(name, 'low');
    else if (i < highCount) result.set(name, 'high');
    else if (i >= n - lowCount) result.set(name, 'low');
    else result.set(name, 'middle');
  }
  return result;
}
```

Update the doc comment above it to describe the min-N rule. Callers: pass `ctx.config.settings.segment_min_n` (views) / `options.segmentMinN ?? 8` (commands — add `segmentMinN?: number` to `LeaderboardOptions`, `ContributionsOptions`, and a third parameter to `recordsToCsv(records, enrichmentStore?, segmentThresholds?, segmentMinN = 8)`), and filter bot records before totals are built: in `contribution-section.ts` wrap the `recs` used for `userTotals` with `excludeBots(recs, ctx.config.settings.bot_patterns)`; in `leaderboard.ts`/`contributions.ts`/`export-data.ts` apply `excludeBots(records, botPatterns)` where `botPatterns` is a new option `botPatterns?: string[]` defaulting to `[]`. Wire `segmentMinN` and `botPatterns` from `cli.ts` (`ctx`/config is loaded in the commands via `loadConfig`? — the commands receive options only; in `cli.ts` load settings with `const cfg = await loadConfig(globals().config)` inside the action and pass `segmentMinN: cfg.settings.segment_min_n, botPatterns: cfg.settings.bot_patterns`).

- [ ] **Step 4: Run tests + typecheck + full suite**

Run: `npx vitest run src/__tests__/bots.test.ts src/__tests__/segments.test.ts && npm test && npx tsc --noEmit`
Expected: green. Other suites that assumed small-N high/low labels (search `'high'` in `src/__tests__/leaderboard.test.ts`, `contributions*.test.ts`, `export-data.test.ts`, `views.test.ts`) must be updated to either use ≥ 8 members or pass `segmentMinN`.

- [ ] **Step 5: Commit**

```bash
git add src/aggregator/bots.ts src/aggregator/segments.ts src/views/components/contribution-section.ts src/commands/leaderboard.ts src/commands/contributions.ts src/commands/export-data.ts src/cli.ts src/__tests__
git commit -m "feat(gitradar): bot-author exclusion and min-N guardrail for segments

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: PR proxy collector (`collector/pr-proxy.ts`)

**Files:**
- Create: `src/collector/pr-proxy.ts`
- Modify: `src/collector/git.ts` (export `makeEmptyRecord`)
- Test: `src/__tests__/pr-proxy.test.ts`

**Interfaces:**
- Consumes: `AuthorMap`, `resolveAuthor`, `IdentifierRule` from `./author-map.js`; `getISOWeek` from `./git.js`; `UserWeekRepoRecord`.
- Produces:
  ```ts
  export interface FirstParentCommit { hash: string; parents: string[]; email: string; name: string; date: string; subject: string; files: Array<{ path: string; insertions: number; deletions: number }> }
  export function parseFirstParentLog(output: string): FirstParentCommit[]
  export function isPullRequest(c: Pick<FirstParentCommit, 'parents' | 'subject'>): boolean
  export async function resolveDefaultBranch(repoPath: string): Promise<string | null>
  export interface PrProxyOptions { repoPath: string; repoName: string; group: string; authorMap: AuthorMap; identifierRules?: IdentifierRule[]; recentPrHashes: Set<string>; since?: string; shouldIgnore: (p: string) => boolean }
  export interface PrProxyResult { records: UserWeekRepoRecord[]; newPrHashes: string[]; prCount: number; branch: string | null }
  export async function runPrProxy(opts: PrProxyOptions): Promise<PrProxyResult>
  ```
  and from `git.ts`: `export function makeEmptyRecord(author: ResolvedAuthor, week: string, repo: string, group: string): UserWeekRepoRecord` (commits 0, activeDays 0, empty intent/filetype, `breakingChanges: 0`, `scopes: []`).

- [ ] **Step 1: Write failing tests** — `src/__tests__/pr-proxy.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorMap } from '../collector/author-map.js';

const mockRaw = vi.fn();
vi.mock('simple-git', () => {
  const factory = vi.fn(() => ({ raw: mockRaw }));
  return { default: factory, simpleGit: factory };
});

const { parseFirstParentLog, isPullRequest, resolveDefaultBranch, runPrProxy } = await import(
  '../collector/pr-proxy.js'
);

function authorMap(): AuthorMap {
  const m: AuthorMap = new Map();
  const alice = { member: 'Alice', email: 'alice@co.com', org: 'Acme', orgType: 'core' as const, team: 'FE', tag: 'default' };
  const bob = { member: 'Bob', email: 'bob@co.com', org: 'Acme', orgType: 'core' as const, team: 'FE', tag: 'default' };
  m.set('alice@co.com', alice); m.set('alice', alice);
  m.set('bob@co.com', bob); m.set('bob', bob);
  return m;
}

const LOG = [
  // merge commit: two parents; author is the merger (Bob); PR author is second parent tip (Alice)
  'aaaaaa1|p1 p2|bob@co.com|Bob|2026-02-18T10:00:00Z|Merge pull request #12 from acme/feat',
  '100\t20\tsrc/a.ts',
  '500\t500\tpackage-lock.json',
  '',
  // squash commit with (#N) suffix
  'bbbbbb2|p3|alice@co.com|Alice|2026-02-19T10:00:00Z|feat: thing (#13)',
  '30\t0\tsrc/b.ts',
  '',
  // direct push, not a PR
  'cccccc3|p4|alice@co.com|Alice|2026-02-19T12:00:00Z|fix typo',
  '1\t1\tREADME.md',
].join('\n');

describe('parseFirstParentLog', () => {
  it('parses hash, parents, author, date, subject and numstat files', () => {
    const commits = parseFirstParentLog(LOG);
    expect(commits).toHaveLength(3);
    expect(commits[0].parents).toEqual(['p1', 'p2']);
    expect(commits[0].subject).toBe('Merge pull request #12 from acme/feat');
    expect(commits[0].files).toEqual([
      { path: 'src/a.ts', insertions: 100, deletions: 20 },
      { path: 'package-lock.json', insertions: 500, deletions: 500 },
    ]);
    expect(commits[1].parents).toEqual(['p3']);
  });
  it('handles subjects containing pipes and binary numstat dashes', () => {
    const [c] = parseFirstParentLog('dddddd4|p9|a@x|A|2026-01-01T00:00:00Z|a | b (#1)\n-\t-\timg.png');
    expect(c.subject).toBe('a | b (#1)');
    expect(c.files).toEqual([{ path: 'img.png', insertions: 0, deletions: 0 }]);
  });
});

describe('isPullRequest', () => {
  it('is true for merge commits and PR-referencing subjects only', () => {
    expect(isPullRequest({ parents: ['a', 'b'], subject: 'anything' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'feat: x (#42)' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'Merge pull request #7 from x/y' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'fix: y (!9)' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'See merge request acme/app!9' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'fix typo' })).toBe(false);
    expect(isPullRequest({ parents: ['a'], subject: 'bump #42 deps' })).toBe(false);
  });
});

describe('resolveDefaultBranch', () => {
  beforeEach(() => mockRaw.mockReset());
  it('prefers origin/HEAD, then main, then master, else null', async () => {
    mockRaw.mockResolvedValueOnce('origin/develop\n');
    expect(await resolveDefaultBranch('/r')).toBe('develop');

    mockRaw.mockRejectedValueOnce(new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref'));
    mockRaw.mockResolvedValueOnce('');               // rev-parse --verify main ok
    expect(await resolveDefaultBranch('/r')).toBe('main');

    mockRaw.mockRejectedValueOnce(new Error('no HEAD'));
    mockRaw.mockRejectedValueOnce(new Error('fatal: Needed a single revision')); // no main
    mockRaw.mockResolvedValueOnce('');               // master ok
    expect(await resolveDefaultBranch('/r')).toBe('master');

    mockRaw.mockRejectedValueOnce(new Error('no HEAD'));
    mockRaw.mockRejectedValueOnce(new Error('no main'));
    mockRaw.mockRejectedValueOnce(new Error('no master'));
    expect(await resolveDefaultBranch('/r')).toBeNull();
  });
});

describe('runPrProxy', () => {
  beforeEach(() => mockRaw.mockReset());

  it('attributes merges to the second-parent author, sizes exclude ignored files, skips direct pushes', async () => {
    mockRaw
      .mockResolvedValueOnce('origin/main\n')                         // symbolic-ref
      .mockResolvedValueOnce(LOG)                                      // first-parent log
      .mockResolvedValueOnce('p2|alice@co.com|Alice\n');              // batched tip lookup for p2

    const result = await runPrProxy({
      repoPath: '/r', repoName: 'web', group: 'default', authorMap: authorMap(),
      recentPrHashes: new Set(), shouldIgnore: (p) => p.endsWith('package-lock.json'),
    });

    expect(result.branch).toBe('main');
    expect(result.prCount).toBe(2);
    expect(result.newPrHashes).toEqual(['aaaaaa1', 'bbbbbb2', 'cccccc3']);
    expect(result.records).toHaveLength(1); // both PRs are Alice, 2026-W08, web
    const rec = result.records[0];
    expect(rec.member).toBe('Alice');
    expect(rec.week).toBe('2026-W08');
    expect(rec.commits).toBe(0);
    expect(rec.prsMergedGit).toBe(2);
    expect(rec.prSizes).toEqual([120, 30]);
    // the tip lookup was batched with --no-walk
    expect(mockRaw.mock.calls[2][0]).toEqual(expect.arrayContaining(['log', '--no-walk', 'p2']));
  });

  it('skips hashes already in recentPrHashes and passes --since', async () => {
    mockRaw.mockResolvedValueOnce('origin/main\n').mockResolvedValueOnce(LOG).mockResolvedValueOnce('p2|alice@co.com|Alice\n');
    const result = await runPrProxy({
      repoPath: '/r', repoName: 'web', group: 'default', authorMap: authorMap(),
      recentPrHashes: new Set(['aaaaaa1']), since: '2026-02-01', shouldIgnore: () => false,
    });
    expect(result.prCount).toBe(1);
    expect(result.newPrHashes).toEqual(['bbbbbb2', 'cccccc3']);
    expect(mockRaw.mock.calls[1][0]).toEqual(expect.arrayContaining(['--since=2026-02-01']));
  });

  it('returns an empty result with branch null when no default branch exists', async () => {
    mockRaw.mockRejectedValue(new Error('nope'));
    const result = await runPrProxy({
      repoPath: '/r', repoName: 'web', group: 'default', authorMap: authorMap(),
      recentPrHashes: new Set(), shouldIgnore: () => false,
    });
    expect(result).toEqual({ records: [], newPrHashes: [], prCount: 0, branch: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/pr-proxy.test.ts`
Expected: FAIL — module `../collector/pr-proxy.js` not found.

- [ ] **Step 3: Export `makeEmptyRecord` from `src/collector/git.ts`**

First, in `src/collector/author-map.ts`, change `interface IdentifierRule {` to `export interface IdentifierRule {` (it is currently module-private; the new collectors import the type).

Below `emptyFiletype()` add:

```ts
/** A zero-metric record for (author, week, repo) — used by post-passes that attach PR/rework counters. */
export function makeEmptyRecord(
  author: ResolvedAuthor,
  week: string,
  repo: string,
  group: string,
): UserWeekRepoRecord {
  return {
    member: author.member, email: author.email, org: author.org, orgType: author.orgType,
    team: author.team, tag: author.tag, week, repo, group,
    commits: 0, activeDays: 0, intent: emptyIntent(), breakingChanges: 0, scopes: [],
    filetype: emptyFiletype(),
  };
}
```

Import `ResolvedAuthor` as a type from `./author-map.js`. Also export the `UNASSIGNED_AUTHOR` fallback used in `processCommitBatch` (`{ member: commit.name, … org: 'unassigned', team: 'unassigned', tag: 'default' }`) as a helper `unassignedAuthor(name: string, email: string): ResolvedAuthor` and use it in both places.

- [ ] **Step 4: Implement `src/collector/pr-proxy.ts`**

```ts
import { simpleGit } from 'simple-git';
import type { UserWeekRepoRecord } from '../types/schema.js';
import type { AuthorMap, IdentifierRule, ResolvedAuthor } from './author-map.js';
import { resolveAuthor } from './author-map.js';
import { classifyGitError, getISOWeek, makeEmptyRecord, unassignedAuthor } from './git.js';

/**
 * Git-only merged-PR proxy.
 *
 * Walks the default branch with --first-parent: every commit on that line is either
 * a merge commit (classic PR merge), a squash/rebase commit, or a direct push. We
 * count a commit as a merged PR when it is a merge commit or its subject carries a
 * PR reference. Size is the diff against the first parent, ignore-filtered.
 */
export interface FirstParentCommit {
  hash: string;
  parents: string[];
  email: string;
  name: string;
  date: string;
  subject: string;
  files: Array<{ path: string; insertions: number; deletions: number }>;
}

const HEADER_RE = /^([0-9a-f]{6,40})\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/;
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

export function parseFirstParentLog(output: string): FirstParentCommit[] {
  const commits: FirstParentCommit[] = [];
  let current: FirstParentCommit | null = null;
  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    const h = HEADER_RE.exec(line);
    if (h) {
      current = {
        hash: h[1],
        parents: h[2].split(' ').filter(Boolean),
        email: h[3],
        name: h[4],
        date: h[5],
        subject: h[6],
        files: [],
      };
      commits.push(current);
      continue;
    }
    const n = NUMSTAT_RE.exec(line);
    if (n && current) {
      current.files.push({
        path: n[3],
        insertions: n[1] === '-' ? 0 : parseInt(n[1], 10),
        deletions: n[2] === '-' ? 0 : parseInt(n[2], 10),
      });
    }
  }
  return commits;
}

const PR_SUBJECT_RES = [
  /\(#\d+\)\s*$/,              // GitHub squash: "feat: x (#42)"
  /^Merge pull request #\d+/,  // GitHub merge commit subject
  /\(!\d+\)\s*$/,              // GitLab squash: "fix: y (!9)"
  /See merge request .*!\d+/,  // GitLab merge commit body-in-subject
];

export function isPullRequest(c: Pick<FirstParentCommit, 'parents' | 'subject'>): boolean {
  if (c.parents.length >= 2) return true;
  return PR_SUBJECT_RES.some((re) => re.test(c.subject));
}

export async function resolveDefaultBranch(repoPath: string): Promise<string | null> {
  const git = simpleGit(repoPath);
  try {
    const ref = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    if (ref) return ref.replace(/^origin\//, '');
  } catch {
    // fall through
  }
  for (const candidate of ['main', 'master']) {
    try {
      await git.raw(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

export interface PrProxyOptions {
  repoPath: string;
  repoName: string;
  group: string;
  authorMap: AuthorMap;
  identifierRules?: IdentifierRule[];
  recentPrHashes: Set<string>;
  since?: string;
  shouldIgnore: (filePath: string) => boolean;
}

export interface PrProxyResult {
  records: UserWeekRepoRecord[];
  newPrHashes: string[];
  prCount: number;
  branch: string | null;
}

export async function runPrProxy(opts: PrProxyOptions): Promise<PrProxyResult> {
  const empty: PrProxyResult = { records: [], newPrHashes: [], prCount: 0, branch: null };
  const branch = await resolveDefaultBranch(opts.repoPath);
  if (!branch) return empty;

  const git = simpleGit(opts.repoPath);
  const args = ['log', '--first-parent', branch, '-m', '--format=%H|%P|%ae|%an|%aI|%s', '--numstat'];
  if (opts.since) args.splice(3, 0, `--since=${opts.since}`);
  let output: string;
  try {
    output = await git.raw(args);
  } catch (error) {
    const err = classifyGitError(error);
    if (err.severity === 'fatal') console.error(`  PR proxy error (${opts.repoName}): ${err.reason}`);
    return { ...empty, branch };
  }

  const commits = parseFirstParentLog(output).filter((c) => !opts.recentPrHashes.has(c.hash));
  const prs = commits.filter(isPullRequest);

  // Merge commits: the PR author is whoever authored the second parent's tip.
  const tipAuthors = new Map<string, { email: string; name: string }>();
  const tips = [...new Set(prs.filter((c) => c.parents.length >= 2).map((c) => c.parents[1]))];
  if (tips.length > 0) {
    try {
      const out = await git.raw(['log', '--no-walk', '--format=%H|%ae|%an', ...tips]);
      for (const line of out.split('\n')) {
        const [hash, email, ...name] = line.trim().split('|');
        if (hash) tipAuthors.set(hash, { email, name: name.join('|') });
      }
    } catch (error) {
      const err = classifyGitError(error);
      if (err.severity === 'fatal') console.error(`  PR proxy tip lookup (${opts.repoName}): ${err.reason}`);
    }
  }

  const byKey = new Map<string, UserWeekRepoRecord>();
  for (const c of prs) {
    const who = c.parents.length >= 2 ? (tipAuthors.get(c.parents[1]) ?? c) : c;
    const author: ResolvedAuthor =
      resolveAuthor(opts.authorMap, who.email, who.name, opts.identifierRules) ??
      unassignedAuthor(who.name, who.email);
    const week = getISOWeek(c.date);
    const key = `${author.member}::${week}::${opts.repoName}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = makeEmptyRecord(author, week, opts.repoName, opts.group);
      rec.prsMergedGit = 0;
      rec.prSizes = [];
      byKey.set(key, rec);
    }
    const size = c.files
      .filter((f) => !opts.shouldIgnore(f.path))
      .reduce((s, f) => s + f.insertions + f.deletions, 0);
    rec.prsMergedGit = (rec.prsMergedGit ?? 0) + 1;
    rec.prSizes!.push(size);
  }

  return {
    records: [...byKey.values()],
    newPrHashes: commits.map((c) => c.hash),
    prCount: prs.length,
    branch,
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/__tests__/pr-proxy.test.ts src/__tests__/git.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/collector/pr-proxy.ts src/collector/git.ts src/__tests__/pr-proxy.test.ts
git commit -m "feat(gitradar): git-only merged-PR proxy via first-parent walk

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rework collector (`collector/rework.ts`) + scan-time inputs

**Files:**
- Create: `src/collector/rework.ts`
- Modify: `src/collector/git.ts` (`ScanResult.reworkInputs`, collect in `processCommitBatch`)
- Test: `src/__tests__/rework.test.ts` (new), `src/__tests__/git.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReworkInput { hash: string; authorEmail: string; authorName: string; authorDate: string; week: string; files: Array<{ path: string; deletions: number }> }
  export function parseDeletedHunks(diff: string): Map<string, Array<{ start: number; count: number }>>
  export function parseBlamePorcelain(out: string): Array<{ email: string; time: number }>   // time = epoch seconds
  export interface ReworkOptions { repoPath: string; repoName: string; group: string; authorMap: AuthorMap; identifierRules?: IdentifierRule[]; windowDays: number; concurrency: number }
  export interface ReworkResult { records: UserWeekRepoRecord[]; commitsProcessed: number; blames: number }
  export async function runRework(inputs: ReworkInput[], opts: ReworkOptions): Promise<ReworkResult>
  ```
  `ScanResult` gains `reworkInputs: ReworkInput[]`; `ScanOptions` gains `collectRework?: boolean` (default true).

- [ ] **Step 1: Write failing tests** — `src/__tests__/rework.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorMap } from '../collector/author-map.js';

const mockRaw = vi.fn();
vi.mock('simple-git', () => {
  const factory = vi.fn(() => ({ raw: mockRaw }));
  return { default: factory, simpleGit: factory };
});

const { parseDeletedHunks, parseBlamePorcelain, runRework } = await import('../collector/rework.js');

function authorMap(): AuthorMap {
  const m: AuthorMap = new Map();
  const alice = { member: 'Alice', email: 'alice@co.com', org: 'Acme', orgType: 'core' as const, team: 'FE', tag: 'default' };
  const bob = { member: 'Bob', email: 'bob@co.com', org: 'Acme', orgType: 'core' as const, team: 'FE', tag: 'default' };
  m.set('alice@co.com', alice); m.set('alice', alice); m.set('bob@co.com', bob); m.set('bob', bob);
  return m;
}

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,3 +10,0 @@ function x() {',
  '-old1', '-old2', '-old3',
  '@@ -20 +17 @@',
  '-old4', '+new4',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -0,0 +1,2 @@',
  '+added', '+added2',
].join('\n');

describe('parseDeletedHunks', () => {
  it('collects deleted ranges per file, ignoring add-only hunks and binaries', () => {
    const hunks = parseDeletedHunks(DIFF);
    expect(hunks.get('src/a.ts')).toEqual([{ start: 10, count: 3 }, { start: 20, count: 1 }]);
    expect(hunks.has('src/b.ts')).toBe(false);
    expect(hunks.has('img.png')).toBe(false);
  });
});

describe('parseBlamePorcelain', () => {
  it('yields one {email,time} per blamed line', () => {
    const out = [
      'abc123 10 10 2', 'author Alice', 'author-mail <alice@co.com>', 'author-time 1700000000', 'author-tz +0000', '\told1',
      'abc123 11 11', '\told2',
      'def456 12 12 1', 'author Bob', 'author-mail <bob@co.com>', 'author-time 1600000000', '\told3',
    ].join('\n');
    expect(parseBlamePorcelain(out)).toEqual([
      { email: 'alice@co.com', time: 1700000000 },
      { email: 'alice@co.com', time: 1700000000 },
      { email: 'bob@co.com', time: 1600000000 },
    ]);
  });
});

describe('runRework', () => {
  beforeEach(() => mockRaw.mockReset());

  it('attributes recently-written deleted lines to their original author in the deletion week', async () => {
    const commitTime = Date.parse('2026-02-18T10:00:00Z') / 1000;
    const recent = commitTime - 5 * 86400;     // 5 days old → rework
    const old = commitTime - 40 * 86400;       // 40 days old → not rework
    mockRaw
      .mockResolvedValueOnce(DIFF) // git diff for C
      .mockResolvedValueOnce([      // blame src/a.ts lines 10-12 + 20
        'h 10 10 3', 'author Alice', 'author-mail <alice@co.com>', `author-time ${recent}`, '\tl',
        'h 11 11', '\tl',
        'h 12 12', '\tl',
        'g 20 20 1', 'author Bob', 'author-mail <bob@co.com>', `author-time ${old}`, '\tl',
      ].join('\n'));

    const result = await runRework(
      [{ hash: 'c1', authorEmail: 'bob@co.com', authorName: 'Bob', authorDate: '2026-02-18T10:00:00Z', week: '2026-W08',
         files: [{ path: 'src/a.ts', deletions: 4 }, { path: 'src/b.ts', deletions: 0 }] }],
      { repoPath: '/r', repoName: 'web', group: 'default', authorMap: authorMap(), windowDays: 21, concurrency: 2 },
    );

    expect(result.commitsProcessed).toBe(1);
    expect(result.blames).toBe(1);
    expect(result.records).toHaveLength(1);
    const alice = result.records[0];
    expect(alice.member).toBe('Alice');
    expect(alice.week).toBe('2026-W08');
    expect(alice.commits).toBe(0);
    expect(alice.reworkLines).toBe(3);
    expect(alice.reworkSelfLines).toBe(0); // Bob deleted Alice's lines
    expect(mockRaw.mock.calls[0][0]).toEqual(expect.arrayContaining(['diff', '-U0', 'c1^', 'c1', '--', 'src/a.ts']));
    expect(mockRaw.mock.calls[1][0]).toEqual(expect.arrayContaining(['blame', '--porcelain', '-w', '-L', '10,12', '-L', '20,20', 'c1^', '--', 'src/a.ts']));
  });

  it('counts self-rework when the deleter is the original author', async () => {
    const t = Date.parse('2026-02-18T10:00:00Z') / 1000 - 86400;
    mockRaw
      .mockResolvedValueOnce('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +0,0 @@\n-a\n-b\n')
      .mockResolvedValueOnce(['h 1 1 2', 'author Alice', 'author-mail <alice@co.com>', `author-time ${t}`, '\ta', 'h 2 2', '\tb'].join('\n'));
    const result = await runRework(
      [{ hash: 'c2', authorEmail: 'alice@co.com', authorName: 'Alice', authorDate: '2026-02-18T10:00:00Z', week: '2026-W08', files: [{ path: 'x', deletions: 2 }] }],
      { repoPath: '/r', repoName: 'web', group: 'default', authorMap: authorMap(), windowDays: 21, concurrency: 1 },
    );
    expect(result.records[0].reworkLines).toBe(2);
    expect(result.records[0].reworkSelfLines).toBe(2);
  });

  it('skips commits with no deleting files and tolerates blame failures', async () => {
    mockRaw.mockResolvedValueOnce('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +0,0 @@\n-a\n').mockRejectedValueOnce(new Error('fatal: no such path'));
    const result = await runRework(
      [
        { hash: 'c3', authorEmail: 'a@x', authorName: 'A', authorDate: '2026-02-18T10:00:00Z', week: '2026-W08', files: [] },
        { hash: 'c4', authorEmail: 'a@x', authorName: 'A', authorDate: '2026-02-18T10:00:00Z', week: '2026-W08', files: [{ path: 'x', deletions: 1 }] },
      ],
      { repoPath: '/r', repoName: 'web', group: 'default', authorMap: authorMap(), windowDays: 21, concurrency: 1 },
    );
    expect(result.commitsProcessed).toBe(1);
    expect(result.records).toEqual([]);
  });
});
```

Add to `src/__tests__/git.test.ts` in `describe('scanRepo')`:

```ts
  it('collects rework inputs for counted commits that delete lines', async () => {
    spawnQueue.push([
      'aaa111|alice@acme.com|Alice Johnson|2026-02-20T10:00:00Z|feat: x',
      '10\t2\tsrc/index.ts',
      '3\t0\tsrc/new.ts',
    ].join('\n'));
    const result = await scanRepo('/repos/frontend', { repoName: 'frontend', group: 'web', authorMap: makeAuthorMap(), recentHashes: new Set() });
    expect(result.reworkInputs).toEqual([
      { hash: 'aaa111', authorEmail: 'alice@acme.com', authorName: 'Alice Johnson', authorDate: '2026-02-20T10:00:00Z', week: '2026-W08', files: [{ path: 'src/index.ts', deletions: 2 }] },
    ]);
  });

  it('does not collect rework inputs when collectRework is false', async () => {
    spawnQueue.push('aaa111|alice@acme.com|Alice Johnson|2026-02-20T10:00:00Z|feat: x\n10\t2\tsrc/index.ts');
    const result = await scanRepo('/repos/frontend', { repoName: 'frontend', group: 'web', authorMap: makeAuthorMap(), recentHashes: new Set(), collectRework: false });
    expect(result.reworkInputs).toEqual([]);
  });
```

(Also add `reworkInputs: []` to `makeScanResult` in `src/__tests__/collector-index.test.ts`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/rework.test.ts src/__tests__/git.test.ts`
Expected: rework suite fails to import; the two scanRepo tests fail (`reworkInputs` undefined).

- [ ] **Step 3: Collect inputs in `src/collector/git.ts`**

- `ScanOptions`: add `/** Collect per-commit deletion info for the rework pass (default true). */ collectRework?: boolean;`
- `ScanResult`: add `/** Inputs for the blame-based rework post-pass (see collector/rework.ts). */ reworkInputs: ReworkInput[];` (import the type from `./rework.js`).
- `processCommitBatch`: add parameter `reworkInputs?: ReworkInput[]` (after `classify`), and after the `countedFiles` loop that accumulates filetype metrics:

```ts
    if (reworkInputs) {
      const deleting = countedFiles
        .filter((f) => f.deletions > 0 && f.status !== 'R' && f.status !== 'C')
        .map((f) => ({ path: f.path, deletions: f.deletions }));
      if (deleting.length > 0) {
        reworkInputs.push({
          hash: commit.hash, authorEmail: commit.email, authorName: commit.name,
          authorDate: commit.date, week, files: deleting,
        });
      }
    }
```

- Thread it: `streamGitLog`'s `batchArgs` gets `reworkInputs?: ReworkInput[]`; `scanRepo` creates `const reworkInputs: ReworkInput[] = []` and passes it when `collectRework !== false`; every `return { … }` in `scanRepo` includes `reworkInputs` (empty array on the fatal-error paths).

- [ ] **Step 4: Implement `src/collector/rework.ts`**

```ts
import pLimit from 'p-limit';
import { simpleGit } from 'simple-git';
import type { UserWeekRepoRecord } from '../types/schema.js';
import type { AuthorMap, IdentifierRule } from './author-map.js';
import { resolveAuthor } from './author-map.js';
import { classifyGitError, makeEmptyRecord, unassignedAuthor } from './git.js';

/**
 * Blame-based rework: for every line a commit deletes, ask `git blame` on the parent
 * who wrote it and when. Lines younger than `windowDays` count as rework against
 * their ORIGINAL author in the week of the deletion (and as self-rework when the
 * deleter is that author). This is "code that didn't survive", not "busy files".
 */
export interface ReworkInput {
  hash: string;
  authorEmail: string;
  authorName: string;
  authorDate: string;
  week: string;
  files: Array<{ path: string; deletions: number }>;
}

export interface ReworkOptions {
  repoPath: string;
  repoName: string;
  group: string;
  authorMap: AuthorMap;
  identifierRules?: IdentifierRule[];
  windowDays: number;
  concurrency: number;
}

export interface ReworkResult {
  records: UserWeekRepoRecord[];
  commitsProcessed: number;
  blames: number;
}

const FILE_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/** Deleted line ranges (old-file numbering) per path from a `-U0` diff. */
export function parseDeletedHunks(diff: string): Map<string, Array<{ start: number; count: number }>> {
  const result = new Map<string, Array<{ start: number; count: number }>>();
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    const f = FILE_RE.exec(line);
    if (f) { file = f[2]; continue; }
    const h = HUNK_RE.exec(line);
    if (h && file) {
      const count = h[2] === undefined ? 1 : parseInt(h[2], 10);
      if (count > 0) {
        const list = result.get(file) ?? [];
        list.push({ start: parseInt(h[1], 10), count });
        result.set(file, list);
      }
    }
  }
  return result;
}

/** One {email,time} per line of `git blame --porcelain` output. */
export function parseBlamePorcelain(out: string): Array<{ email: string; time: number }> {
  const byCommit = new Map<string, { email: string; time: number }>();
  const lines: Array<{ email: string; time: number }> = [];
  let current: string | null = null;
  let pending: { email?: string; time?: number } = {};
  for (const line of out.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/.exec(line);
    if (header) { current = header[1]; pending = {}; continue; }
    if (line.startsWith('author-mail ')) { pending.email = line.slice(12).trim().replace(/^<|>$/g, ''); continue; }
    if (line.startsWith('author-time ')) { pending.time = parseInt(line.slice(12), 10); continue; }
    if (line.startsWith('\t') && current) {
      if (pending.email !== undefined && pending.time !== undefined) {
        byCommit.set(current, { email: pending.email, time: pending.time });
      }
      const meta = byCommit.get(current);
      if (meta) lines.push(meta);
    }
  }
  return lines;
}

export async function runRework(inputs: ReworkInput[], opts: ReworkOptions): Promise<ReworkResult> {
  const git = simpleGit(opts.repoPath);
  const limit = pLimit(Math.max(1, opts.concurrency));
  const byKey = new Map<string, UserWeekRepoRecord>();
  let commitsProcessed = 0;
  let blames = 0;
  const windowSec = opts.windowDays * 86400;

  const bump = (email: string, name: string, week: string, self: boolean) => {
    const author = resolveAuthor(opts.authorMap, email, name, opts.identifierRules) ?? unassignedAuthor(name, email);
    const key = `${author.member}::${week}::${opts.repoName}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = makeEmptyRecord(author, week, opts.repoName, opts.group);
      rec.reworkLines = 0;
      rec.reworkSelfLines = 0;
      byKey.set(key, rec);
    }
    rec.reworkLines = (rec.reworkLines ?? 0) + 1;
    if (self) rec.reworkSelfLines = (rec.reworkSelfLines ?? 0) + 1;
  };

  await Promise.all(
    inputs.map((c) =>
      limit(async () => {
        const paths = c.files.filter((f) => f.deletions > 0).map((f) => f.path);
        if (paths.length === 0) return;
        commitsProcessed++;
        let diff: string;
        try {
          diff = await git.raw(['diff', '-U0', '--no-color', '--diff-filter=MD', `${c.hash}^`, c.hash, '--', ...paths]);
        } catch (error) {
          const err = classifyGitError(error);
          if (err.severity === 'fatal') console.error(`  Rework diff error (${c.hash.slice(0, 8)}): ${err.reason}`);
          return; // root commits and missing parents land here
        }
        const commitSec = Date.parse(c.authorDate) / 1000;
        const deleter = resolveAuthor(opts.authorMap, c.authorEmail, c.authorName, opts.identifierRules)?.member ?? c.authorName;
        for (const [path, ranges] of parseDeletedHunks(diff)) {
          const args = ['blame', '--porcelain', '-w'];
          for (const r of ranges) args.push('-L', `${r.start},${r.start + r.count - 1}`);
          args.push(`${c.hash}^`, '--', path);
          let out: string;
          try {
            out = await git.raw(args);
            blames++;
          } catch (error) {
            const err = classifyGitError(error);
            if (err.severity === 'fatal') console.error(`  Rework blame error (${path}): ${err.reason}`);
            continue;
          }
          for (const line of parseBlamePorcelain(out)) {
            if (commitSec - line.time > windowSec) continue;
            const origMember = resolveAuthor(opts.authorMap, line.email, '', opts.identifierRules)?.member;
            bump(line.email, '', c.week, origMember !== undefined && origMember === deleter);
          }
        }
      }),
    ),
  );

  return { records: [...byKey.values()], commitsProcessed, blames };
}
```

Note: `resolveAuthor` with an empty name must fall back to email-only resolution — check `author-map.ts:153-200`; if it requires a name, pass `line.email` as the name. The unassigned record's `member` is the name → use the email when the name is empty (`unassignedAuthor(name || email, email)`).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/__tests__/rework.test.ts src/__tests__/git.test.ts src/__tests__/collector-index.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/collector/rework.ts src/collector/git.ts src/__tests__/rework.test.ts src/__tests__/git.test.ts src/__tests__/collector-index.test.ts
git commit -m "feat(gitradar): blame-based rework collector and scan-time inputs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire post-passes into the scan pipeline + `--skip-rework`

**Files:**
- Modify: `src/collector/index.ts` (after `scanRepo` per repo), `src/engine/gitradar-engine.ts` (`RunOptions.skipRework`, `scan()`), `src/cli.ts` (global + `scan` option), `src/commands/run-main.ts` (pass-through only if needed)
- Test: `src/__tests__/collector-index.test.ts`

**Interfaces:**
- Consumes: `runPrProxy`, `runRework`, `buildIgnoreMatcher`, `rotateHashes`, `updateRepoState`.
- Produces: `scanAllRepos` options gain `skipRework?: boolean`; `ScanAllResult.stats` gains `totalPrs: number; totalReworkCommits: number`; records passed to `onRepoScanned` are the scan records **plus** post-pass records (merged by key before the callback).

- [ ] **Step 1: Write failing tests** in `src/__tests__/collector-index.test.ts` (the file already mocks `../collector/git.js`; add mocks for the two new modules next to it):

```ts
vi.mock('../collector/pr-proxy.js', () => ({ runPrProxy: vi.fn() }));
vi.mock('../collector/rework.js', () => ({ runRework: vi.fn() }));
const { runPrProxy } = await import('../collector/pr-proxy.js');
const { runRework } = await import('../collector/rework.js');
```

```ts
  it('runs the PR proxy and rework passes after each repo scan and merges their records', async () => {
    vi.mocked(scanRepo).mockResolvedValueOnce(makeScanResult({
      newRecords: [makeRecord('Alice', 'app')], newHashes: ['h1'], commitCount: 1,
      reworkInputs: [{ hash: 'h1', authorEmail: 'a', authorName: 'A', authorDate: '2026-03-01T00:00:00Z', week: '2026-W10', files: [{ path: 'x', deletions: 1 }] }],
    }));
    vi.mocked(runPrProxy).mockResolvedValueOnce({
      records: [{ ...makeRecord('Alice', 'app'), commits: 0, prsMergedGit: 2, prSizes: [10, 20] }],
      newPrHashes: ['m1'], prCount: 2, branch: 'main',
    });
    vi.mocked(runRework).mockResolvedValueOnce({
      records: [{ ...makeRecord('Bob', 'app'), commits: 0, reworkLines: 4, reworkSelfLines: 1 }],
      commitsProcessed: 1, blames: 1,
    });

    const scanned: UserWeekRepoRecord[][] = [];
    const result = await scanAllRepos(makeConfig(), makeScanState(), {
      onRepoScanned: async (recs) => { scanned.push(recs); },
    });

    expect(runRework).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ hash: 'h1' })]),
      expect.objectContaining({ repoName: 'app', windowDays: 21, concurrency: 3 }),
    );
    expect(runPrProxy).toHaveBeenCalledWith(expect.objectContaining({ repoName: 'app', recentPrHashes: new Set() }));
    expect(scanned).toHaveLength(1);
    const alice = scanned[0].find((r) => r.member === 'Alice')!;
    expect(alice.commits).toBe(makeRecord('Alice', 'app').commits); // scan record kept
    expect(alice.prsMergedGit).toBe(2);                              // proxy merged into it
    expect(alice.prSizes).toEqual([10, 20]);
    const bob = scanned[0].find((r) => r.member === 'Bob')!;
    expect(bob.commits).toBe(0);
    expect(bob.reworkLines).toBe(4);
    expect(result.updatedScanState.repos.app.recentPrHashes).toEqual(['m1']);
    expect(result.stats.totalPrs).toBe(2);
    expect(result.stats.totalReworkCommits).toBe(1);
  });

  it('skips the rework pass when skipRework is set or rework_enabled is false', async () => {
    vi.mocked(scanRepo).mockResolvedValue(makeScanResult({ newRecords: [makeRecord('Alice', 'app')] }));
    vi.mocked(runPrProxy).mockResolvedValue({ records: [], newPrHashes: [], prCount: 0, branch: 'main' });
    vi.mocked(runRework).mockClear();

    await scanAllRepos(makeConfig(), makeScanState(), { skipRework: true });
    expect(runRework).not.toHaveBeenCalled();

    await scanAllRepos(makeConfig({ settings: { ...DEFAULT_SETTINGS, rework_enabled: false } }), makeScanState(), {});
    expect(runRework).not.toHaveBeenCalled();
    expect(scanRepo).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ collectRework: false }));
  });

  it('reuses the stored recentPrHashes cursor and rotates it', async () => {
    vi.mocked(scanRepo).mockResolvedValue(makeScanResult({}));
    vi.mocked(runPrProxy).mockResolvedValue({ records: [], newPrHashes: ['m2'], prCount: 1, branch: 'main' });
    vi.mocked(runRework).mockResolvedValue({ records: [], commitsProcessed: 0, blames: 0 });
    const state = makeScanState({ app: { lastHash: 'x', lastScanDate: '2020-01-01T00:00:00Z', recentHashes: [], recordCount: 0, recentPrHashes: ['m1'] } });
    const result = await scanAllRepos(makeConfig(), state, { forceScan: true });
    expect(runPrProxy).toHaveBeenCalledWith(expect.objectContaining({ recentPrHashes: new Set(['m1']) }));
    expect(result.updatedScanState.repos.app.recentPrHashes).toEqual(['m2', 'm1']);
  });
```

(Adjust `makeConfig`/`makeRecord` helper usage to whatever the file already defines; `makeRecord(member, repo)` exists.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/collector-index.test.ts`
Expected: new tests FAIL (`runRework` not called / `recentPrHashes` undefined / `totalPrs` undefined).

- [ ] **Step 3: Implement in `src/collector/index.ts`**

Imports: `import { buildIgnoreMatcher } from './classifier.js'; import { runPrProxy } from './pr-proxy.js'; import { runRework } from './rework.js';`. Options gain `skipRework?: boolean`. Stats gain `totalPrs`, `totalReworkCommits` (initialise 0). In the per-repo loop, after `const result = await scanRepo(repo.path, { … , collectRework: reworkEnabled })` where `const reworkEnabled = !options?.skipRework && config.settings.rework_enabled;`:

```ts
    // ── Post-passes: rework (blame) and merged-PR proxy ───────────────────
    const shouldIgnore = buildIgnoreMatcher(config.settings.ignore_patterns, {
      replaceDefaults: config.settings.ignore_patterns_replace_defaults,
    });
    const extra: UserWeekRepoRecord[] = [];
    let prHashes: string[] = [];

    if (reworkEnabled && result.reworkInputs.length > 0) {
      const rw = await runRework(result.reworkInputs, {
        repoPath: repo.path, repoName, group: repo.group, authorMap, identifierRules,
        windowDays: config.settings.churn_window_days, concurrency: config.settings.churn_concurrency,
      });
      extra.push(...rw.records);
      totalReworkCommits += rw.commitsProcessed;
      console.log(`  rework: ${rw.commitsProcessed} commits, ${rw.blames} blames`);
    }

    const pr = await runPrProxy({
      repoPath: repo.path, repoName, group: repo.group, authorMap, identifierRules,
      recentPrHashes: new Set(repoState?.recentPrHashes ?? []), since, shouldIgnore,
    });
    if (pr.branch === null) console.log(`  PR proxy: no default branch found for ${repoName}`);
    extra.push(...pr.records);
    prHashes = pr.newPrHashes;
    totalPrs += pr.prCount;

    const merged = mergeRecordsByKey(result.newRecords, extra);
```

Replace the existing `onRepoScanned(result.newRecords)` / `allNewRecords.push(...result.newRecords)` with `merged`, keep `totalRecords += merged.length`, and add `recentPrHashes: rotateHashes(repoState?.recentPrHashes ?? [], prHashes)` to the `updateRepoState` call. Add the helper at the bottom of the file:

```ts
/** Merge post-pass records into scan records by (member, week, repo), summing the additive counters. */
function mergeRecordsByKey(base: UserWeekRepoRecord[], extra: UserWeekRepoRecord[]): UserWeekRepoRecord[] {
  const byKey = new Map<string, UserWeekRepoRecord>();
  for (const r of base) byKey.set(`${r.member}::${r.week}::${r.repo}`, r);
  for (const e of extra) {
    const key = `${e.member}::${e.week}::${e.repo}`;
    const r = byKey.get(key);
    if (!r) { byKey.set(key, e); continue; }
    r.prsMergedGit = (r.prsMergedGit ?? 0) + (e.prsMergedGit ?? 0);
    if (e.prSizes?.length) r.prSizes = [...(r.prSizes ?? []), ...e.prSizes];
    r.reworkLines = (r.reworkLines ?? 0) + (e.reworkLines ?? 0);
    r.reworkSelfLines = (r.reworkSelfLines ?? 0) + (e.reworkSelfLines ?? 0);
  }
  return [...byKey.values()];
}
```

Engine: `RunOptions` gains `skipRework?: boolean`; `scan()` passes `skipRework: opts.skipRework` to `scanAllRepos` and appends `· ${result.stats.totalPrs} PRs` to the "Scan complete" line. CLI: add `.option('--skip-rework', 'Skip the blame-based rework pass')` to the root program and to `scan`; forward `skipRework: cmdOpts.skipRework ?? g.skipRework` in the scan action and add `skipRework?: boolean` to the `globals()` type.

- [ ] **Step 4: Run tests + full suite + typecheck**

Run: `npx vitest run src/__tests__/collector-index.test.ts && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collector/index.ts src/engine/gitradar-engine.ts src/cli.ts src/__tests__/collector-index.test.ts
git commit -m "feat(gitradar): run PR-proxy and rework passes after each repo scan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Scorecard aggregator (`aggregator/scorecard.ts`)

**Files:**
- Create: `src/aggregator/scorecard.ts`
- Test: `src/__tests__/scorecard.test.ts`

**Interfaces:**
- Consumes: `rollup` (engine), `getLastNWeeks` (filters), `testPct` (metrics), `excludeBots` (bots), `SCORECARD_METRIC_KEYS`/`ScorecardMetricKey` (schema), `EnrichmentStore`.
- Produces:
  ```ts
  export type MetricKey = ScorecardMetricKey;
  export type Family = 'throughput' | 'flow' | 'quality' | 'collab';
  export type BetterWhen = 'high' | 'low' | 'neutral';
  export interface MetricDef { key: MetricKey; family: Family; label: string; betterWhen: BetterWhen; core: boolean; format: 'int' | 'dec1' | 'pct' | 'ratio' | 'hours' }
  export const METRICS: readonly MetricDef[]
  export const FAMILIES: readonly Family[]
  export interface Cell { value: number | null; baseline: number | null; deltaPct: number | null; percentile: number | null }
  export interface ScorecardRow { member: string; team: string; org: string; orgType: 'core' | 'consultant'; activeWeeks: number; baselineActiveWeeks: number; cells: Record<MetricKey, Cell>; score: number | null }
  export interface Scorecard { window: string[]; baseline: string[]; cohortSize: number; minN: number; sources: { enrichment: boolean; prProxy: boolean; rework: boolean }; metrics: readonly MetricDef[]; rows: ScorecardRow[]; hasScore: boolean }
  export interface ScorecardSettings { trend_threshold: number; scorecard_min_n: number; scorecard_weights?: Record<string, number>; bot_patterns: string[] }
  export function computeScorecard(input: { records: UserWeekRepoRecord[]; enrichments?: EnrichmentStore; currentWeek: string; windowWeeks: number; settings: ScorecardSettings }): Scorecard
  export function percentile(sorted: number[], p: number): number   // nearest-rank on a sorted ascending array
  export function sortRows(rows: ScorecardRow[], key: MetricKey | 'member' | 'score', desc: boolean): ScorecardRow[]
  ```

- [ ] **Step 1: Write failing tests** — `src/__tests__/scorecard.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { computeScorecard, METRICS, percentile, sortRows } from '../aggregator/scorecard.js';
import type { EnrichmentStore, UserWeekRepoRecord } from '../types/schema.js';

const SETTINGS = { trend_threshold: 0.1, scorecard_min_n: 8, bot_patterns: ['[bot]', 'dependabot'] };
const CUR = '2026-W12'; // window 4 = W09..W12, baseline = W05..W08

function rec(o: Partial<UserWeekRepoRecord> & { member: string; week: string }): UserWeekRepoRecord {
  return {
    email: `${o.member.toLowerCase()}@co.com`, org: 'Acme', orgType: 'core', team: 'FE', tag: 'default',
    repo: 'web', group: 'default', commits: 3, activeDays: 2, activeDayMask: 0b11,
    intent: { feat: 2, fix: 1, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 },
    breakingChanges: 0, scopes: ['auth'],
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 10 },
      test: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 50, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...o,
  } as UserWeekRepoRecord;
}

describe('percentile', () => {
  it('uses nearest-rank on a sorted array', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 75)).toBe(30);
    expect(percentile([7], 50)).toBe(7);
  });
});

describe('computeScorecard — normalisation', () => {
  it('divides throughput by ACTIVE weeks, not window weeks', () => {
    const records = [
      rec({ member: 'Alice', week: '2026-W12', commits: 6 }),
      rec({ member: 'Alice', week: '2026-W10', commits: 2 }),
      // W11 and W09: no commits → 2 active weeks
    ];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    const alice = sc.rows[0];
    expect(alice.activeWeeks).toBe(2);
    expect(alice.cells.commitsPerWeek.value).toBe(4);
    expect(alice.cells.daysPerWeek.value).toBe(2); // mask 0b11 → 2 days each active week
  });

  it('a zero-commit holder record (rework only) is not an active week', () => {
    const records = [
      rec({ member: 'Alice', week: '2026-W12', commits: 3 }),
      rec({ member: 'Alice', week: '2026-W11', commits: 0, activeDays: 0, activeDayMask: 0, reworkLines: 5 }),
    ];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(sc.rows[0].activeWeeks).toBe(1);
    expect(sc.rows[0].cells.commitsPerWeek.value).toBe(3);
  });

  it('computes the baseline from the preceding window and a signed delta', () => {
    const records = [
      rec({ member: 'Alice', week: '2026-W12', commits: 8 }),   // window: 8 / 1 active wk
      rec({ member: 'Alice', week: '2026-W07', commits: 4 }),   // baseline: 4 / 1 active wk
    ];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(sc.window).toEqual(['2026-W09', '2026-W10', '2026-W11', '2026-W12']);
    expect(sc.baseline).toEqual(['2026-W05', '2026-W06', '2026-W07', '2026-W08']);
    const c = sc.rows[0].cells.commitsPerWeek;
    expect(c.baseline).toBe(4);
    expect(c.deltaPct).toBe(100);
  });

  it('delta is null when there is no baseline', () => {
    const sc = computeScorecard({ records: [rec({ member: 'Alice', week: '2026-W12' })], currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(sc.rows[0].cells.commitsPerWeek.baseline).toBeNull();
    expect(sc.rows[0].cells.commitsPerWeek.deltaPct).toBeNull();
  });
});

describe('computeScorecard — metric definitions', () => {
  it('derives flow, quality and collaboration metrics from records and enrichment', () => {
    const enrichments: EnrichmentStore = {
      version: 1, lastUpdated: '', enrichments: {
        'Alice::2026-W12::web': { prs_opened: 2, prs_merged: 2, avg_cycle_hrs: 10, reviews_given: 4, churn_rate_pct: 0, pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0 },
        'Alice::2026-W11::web': { prs_opened: 1, prs_merged: 1, avg_cycle_hrs: 40, reviews_given: 2, churn_rate_pct: 0, pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0 },
      },
    };
    const records = [
      rec({ member: 'Alice', week: '2026-W12', prsMergedGit: 2, prSizes: [100, 300], reworkLines: 30, reworkSelfLines: 10, breakingChanges: 1, scopes: ['auth', 'api'],
            intent: { feat: 2, fix: 3, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 } }),
      rec({ member: 'Alice', week: '2026-W11', repo: 'api', prsMergedGit: 1, prSizes: [50], scopes: ['db'] }),
    ];
    const sc = computeScorecard({ records, enrichments, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    const c = sc.rows[0].cells;
    expect(c.prsPerWeek.value).toBe(1.5);                       // 3 PRs / 2 active weeks
    expect(c.prSizeP50.value).toBe(100);                        // [50,100,300]
    expect(c.prSizeP75.value).toBe(300);
    expect(c.cycleHrs.value).toBe(26.7);                        // (10*2 + 40*1) / 3
    expect(c.reworkPct.value).toBe(10);                         // 30 / (150+150) inserted
    expect(c.fixToFeat.value).toBeCloseTo(4 / 4);               // fix 3+1, feat 2+2
    expect(c.testPct.value).toBe(31);                           // 100 test / (220 app + 100 test)
    expect(c.breaking.value).toBe(1);
    expect(c.reviews.value).toBe(6);
    expect(c.reviewsPerPr.value).toBe(2);                       // 6 / max(3 proxy, 3 opened)
    expect(c.repos.value).toBe(2);
    expect(c.scopes.value).toBe(3);
    expect(sc.sources).toEqual({ enrichment: true, prProxy: true, rework: true });
  });

  it('returns null cells (not zero) when a source is absent', () => {
    const sc = computeScorecard({ records: [rec({ member: 'Alice', week: '2026-W12' })], currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    const c = sc.rows[0].cells;
    expect(c.prSizeP50.value).toBeNull();
    expect(c.cycleHrs.value).toBeNull();
    expect(c.reviews.value).toBeNull();
    expect(c.reworkPct.value).toBeNull();
    expect(c.fixToFeat.value).toBe(0.5);
    expect(sc.sources).toEqual({ enrichment: false, prProxy: false, rework: false });
  });

  it('METRICS lists 14 metrics, 10 of them core, in family order', () => {
    expect(METRICS).toHaveLength(14);
    expect(METRICS.filter((m) => m.core)).toHaveLength(10);
    expect(METRICS.map((m) => m.family)).toEqual([
      'throughput', 'throughput', 'throughput', 'flow', 'flow', 'flow',
      'quality', 'quality', 'quality', 'quality', 'collab', 'collab', 'collab', 'collab',
    ]);
  });
});

describe('computeScorecard — cohort, percentiles, bots, composite', () => {
  const cohort = (n: number) =>
    Array.from({ length: n }, (_, i) => rec({ member: `M${i}`, week: '2026-W12', commits: (i + 1) * 2 }));

  it('suppresses percentiles below minN and computes them at or above it', () => {
    const small = computeScorecard({ records: cohort(5), currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(small.cohortSize).toBe(5);
    expect(small.rows.every((r) => r.cells.commitsPerWeek.percentile === null)).toBe(true);

    const big = computeScorecard({ records: cohort(8), currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    const byName = new Map(big.rows.map((r) => [r.member, r]));
    expect(byName.get('M0')!.cells.commitsPerWeek.percentile).toBe(0);
    expect(byName.get('M7')!.cells.commitsPerWeek.percentile).toBe(100);
    expect(byName.get('M3')!.cells.commitsPerWeek.percentile).toBe(43); // 3 below / 7
  });

  it('excludes bot authors from rows and cohort', () => {
    const records = [...cohort(8), rec({ member: 'dependabot[bot]', week: '2026-W12', commits: 900 })];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(sc.cohortSize).toBe(8);
    expect(sc.rows.some((r) => r.member.includes('bot'))).toBe(false);
  });

  it('has no score unless weights are configured; weights are direction-aware', () => {
    const none = computeScorecard({ records: cohort(8), currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(none.hasScore).toBe(false);
    expect(none.rows[0].score).toBeNull();

    const records = cohort(8).map((r, i) => ({ ...r, reworkLines: (8 - i) * 10 })); // M0 has most rework
    const weighted = computeScorecard({
      records, currentWeek: CUR, windowWeeks: 4,
      settings: { ...SETTINGS, scorecard_weights: { commitsPerWeek: 1, reworkPct: 1 } },
    });
    expect(weighted.hasScore).toBe(true);
    const byName = new Map(weighted.rows.map((r) => [r.member, r]));
    // M7: commits pctl 100, rework pctl 0 (least rework, low-is-better → adj 100) → 100
    expect(byName.get('M7')!.score).toBe(100);
    expect(byName.get('M0')!.score).toBe(0);
  });

  it('score ignores metrics without a percentile and is null when none apply', () => {
    const sc = computeScorecard({
      records: cohort(8), currentWeek: CUR, windowWeeks: 4,
      settings: { ...SETTINGS, scorecard_weights: { reviews: 5, commitsPerWeek: 1 } }, // no enrichment → reviews null
    });
    expect(new Map(sc.rows.map((r) => [r.member, r])).get('M7')!.score).toBe(100);
    const onlyNull = computeScorecard({
      records: cohort(8), currentWeek: CUR, windowWeeks: 4,
      settings: { ...SETTINGS, scorecard_weights: { reviews: 5 } },
    });
    expect(onlyNull.rows[0].score).toBeNull();
  });
});

describe('sortRows', () => {
  it('sorts by a metric with nulls last, and by member name', () => {
    const sc = computeScorecard({
      records: [
        rec({ member: 'B', week: '2026-W12', commits: 1 }),
        rec({ member: 'A', week: '2026-W12', commits: 5 }),
        rec({ member: 'C', week: '2026-W12', commits: 3, prsMergedGit: 1, prSizes: [9] }),
      ],
      currentWeek: CUR, windowWeeks: 4, settings: SETTINGS,
    });
    expect(sortRows(sc.rows, 'commitsPerWeek', true).map((r) => r.member)).toEqual(['A', 'C', 'B']);
    expect(sortRows(sc.rows, 'prSizeP50', true).map((r) => r.member)).toEqual(['C', 'A', 'B']);
    expect(sortRows(sc.rows, 'prSizeP50', false).map((r) => r.member)).toEqual(['C', 'A', 'B']);
    expect(sortRows(sc.rows, 'member', false).map((r) => r.member)).toEqual(['A', 'B', 'C']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/scorecard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/aggregator/scorecard.ts`**

```ts
import type { EnrichmentStore, ScorecardMetricKey, UserWeekRepoRecord } from '../types/schema.js';
import { excludeBots } from './bots.js';
import { rollup } from './engine.js';
import { getLastNWeeks } from './filters.js';
import { testPct } from './metrics.js';

/**
 * Per-member scorecard: every metric is reported three ways — raw value, delta vs the
 * member's own preceding window, and percentile within the visible cohort. No metric
 * is a line count, per-week metrics divide by ACTIVE weeks, and nothing is combined
 * into a single number unless the user configures weights.
 */
export type MetricKey = ScorecardMetricKey;
export type Family = 'throughput' | 'flow' | 'quality' | 'collab';
export type BetterWhen = 'high' | 'low' | 'neutral';

export interface MetricDef {
  key: MetricKey;
  family: Family;
  label: string;
  betterWhen: BetterWhen;
  /** Shown on the overview page. */
  core: boolean;
  format: 'int' | 'dec1' | 'pct' | 'ratio' | 'hours';
}

export const FAMILIES: readonly Family[] = ['throughput', 'flow', 'quality', 'collab'];

export const METRICS: readonly MetricDef[] = [
  { key: 'commitsPerWeek', family: 'throughput', label: 'cmt/wk', betterWhen: 'high', core: true, format: 'dec1' },
  { key: 'daysPerWeek', family: 'throughput', label: 'days/wk', betterWhen: 'high', core: true, format: 'dec1' },
  { key: 'prsPerWeek', family: 'throughput', label: 'PRs/wk', betterWhen: 'high', core: true, format: 'dec1' },
  { key: 'prSizeP50', family: 'flow', label: 'PR p50', betterWhen: 'low', core: true, format: 'int' },
  { key: 'prSizeP75', family: 'flow', label: 'PR p75', betterWhen: 'low', core: false, format: 'int' },
  { key: 'cycleHrs', family: 'flow', label: 'cycle', betterWhen: 'low', core: true, format: 'hours' },
  { key: 'reworkPct', family: 'quality', label: 'rework%', betterWhen: 'low', core: true, format: 'pct' },
  { key: 'fixToFeat', family: 'quality', label: 'fix:feat', betterWhen: 'neutral', core: true, format: 'ratio' },
  { key: 'testPct', family: 'quality', label: 'test%', betterWhen: 'neutral', core: true, format: 'pct' },
  { key: 'breaking', family: 'quality', label: 'brk', betterWhen: 'neutral', core: false, format: 'int' },
  { key: 'reviews', family: 'collab', label: 'reviews', betterWhen: 'high', core: true, format: 'int' },
  { key: 'reviewsPerPr', family: 'collab', label: 'rev/PR', betterWhen: 'high', core: false, format: 'dec1' },
  { key: 'repos', family: 'collab', label: 'repos', betterWhen: 'neutral', core: true, format: 'int' },
  { key: 'scopes', family: 'collab', label: 'scopes', betterWhen: 'neutral', core: false, format: 'int' },
];

export interface Cell {
  value: number | null;
  baseline: number | null;
  deltaPct: number | null;
  percentile: number | null;
}

export interface ScorecardRow {
  member: string;
  team: string;
  org: string;
  orgType: 'core' | 'consultant';
  activeWeeks: number;
  baselineActiveWeeks: number;
  cells: Record<MetricKey, Cell>;
  score: number | null;
}

export interface Scorecard {
  window: string[];
  baseline: string[];
  cohortSize: number;
  minN: number;
  sources: { enrichment: boolean; prProxy: boolean; rework: boolean };
  metrics: readonly MetricDef[];
  rows: ScorecardRow[];
  hasScore: boolean;
}

export interface ScorecardSettings {
  trend_threshold: number;
  scorecard_min_n: number;
  scorecard_weights?: Record<string, number>;
  bot_patterns: string[];
}

/** Nearest-rank percentile of a sorted ascending array (p in 0..100). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

// ── Per-member window statistics ──────────────────────────────────────────────

interface WindowStats {
  activeWeeks: number;
  commits: number;
  activeDays: number;
  prsMergedGit: number;
  prSizes: number[];
  reworkLines: number;
  insertions: number;
  fix: number;
  feat: number;
  breaking: number;
  testPct: number | null;
  repos: number;
  scopes: number;
  prsOpenedEnrich: number | null;
  reviews: number | null;
  cycleWeighted: number;
  cycleWeight: number;
}

function windowStats(
  records: UserWeekRepoRecord[],
  weeks: Set<string>,
  enrichments?: EnrichmentStore,
): WindowStats {
  const inWindow = records.filter((r) => weeks.has(r.week));
  const agg = rollup(inWindow, () => 'all').get('all');
  const activeWeekSet = new Set<string>();
  const repoSet = new Set<string>();
  const scopeSet = new Set<string>();
  let fix = 0;
  let feat = 0;
  let prsOpened: number | null = null;
  let reviews: number | null = null;
  let cycleWeighted = 0;
  let cycleWeight = 0;

  for (const r of inWindow) {
    if (r.commits > 0) {
      activeWeekSet.add(r.week);
      repoSet.add(r.repo);
    }
    for (const s of r.scopes ?? []) scopeSet.add(s);
    fix += r.intent?.fix ?? 0;
    feat += r.intent?.feat ?? 0;
    const e = enrichments?.enrichments[`${r.member}::${r.week}::${r.repo}`];
    if (e) {
      prsOpened = (prsOpened ?? 0) + e.prs_opened;
      reviews = (reviews ?? 0) + e.reviews_given;
      if (e.prs_merged > 0) {
        cycleWeighted += e.avg_cycle_hrs * e.prs_merged;
        cycleWeight += e.prs_merged;
      }
    }
  }

  return {
    activeWeeks: activeWeekSet.size,
    commits: agg?.commits ?? 0,
    activeDays: agg?.activeDays ?? 0,
    prsMergedGit: agg?.prsMergedGit ?? 0,
    prSizes: [...(agg?.prSizes ?? [])].sort((a, b) => a - b),
    reworkLines: agg?.reworkLines ?? 0,
    insertions: agg?.insertions ?? 0,
    fix,
    feat,
    breaking: agg?.breakingChanges ?? 0,
    testPct: agg && agg.filetype.app.insertions + agg.filetype.app.deletions + agg.filetype.test.insertions + agg.filetype.test.deletions > 0
      ? testPct(agg.filetype)
      : null,
    repos: repoSet.size,
    scopes: scopeSet.size,
    prsOpenedEnrich: prsOpened,
    reviews,
    cycleWeighted,
    cycleWeight,
  };
}

function perWeek(n: number, weeks: number): number | null {
  return weeks > 0 ? Math.round((n / weeks) * 10) / 10 : null;
}

function metricValue(key: MetricKey, s: WindowStats, sources: Scorecard['sources']): number | null {
  switch (key) {
    case 'commitsPerWeek': return perWeek(s.commits, s.activeWeeks);
    case 'daysPerWeek': return perWeek(s.activeDays, s.activeWeeks);
    case 'prsPerWeek': return sources.prProxy ? perWeek(s.prsMergedGit, s.activeWeeks) : null;
    case 'prSizeP50': return s.prSizes.length ? percentile(s.prSizes, 50) : null;
    case 'prSizeP75': return s.prSizes.length ? percentile(s.prSizes, 75) : null;
    case 'cycleHrs': return s.cycleWeight > 0 ? Math.round((s.cycleWeighted / s.cycleWeight) * 10) / 10 : null;
    case 'reworkPct': return sources.rework && s.insertions > 0 ? Math.round((s.reworkLines / s.insertions) * 1000) / 10 : null;
    case 'fixToFeat': return s.feat > 0 ? Math.round((s.fix / s.feat) * 100) / 100 : null;
    case 'testPct': return s.testPct;
    case 'breaking': return s.activeWeeks > 0 ? s.breaking : null;
    case 'reviews': return s.reviews;
    case 'reviewsPerPr': {
      const denom = Math.max(s.prsMergedGit, s.prsOpenedEnrich ?? 0);
      return s.reviews !== null && denom > 0 ? Math.round((s.reviews / denom) * 10) / 10 : null;
    }
    case 'repos': return s.activeWeeks > 0 ? s.repos : null;
    case 'scopes': return s.activeWeeks > 0 ? s.scopes : null;
  }
}

function deltaPct(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null || baseline === 0) return null;
  return Math.round(((value - baseline) / Math.abs(baseline)) * 100);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeScorecard(input: {
  records: UserWeekRepoRecord[];
  enrichments?: EnrichmentStore;
  currentWeek: string;
  windowWeeks: number;
  settings: ScorecardSettings;
}): Scorecard {
  const { settings } = input;
  const window = getLastNWeeks(input.windowWeeks, input.currentWeek);
  const baseline = getLastNWeeks(input.windowWeeks * 2, input.currentWeek).slice(0, input.windowWeeks);
  const windowSet = new Set(window);
  const baselineSet = new Set(baseline);

  const records = excludeBots(input.records, settings.bot_patterns);
  const sources = {
    enrichment: !!input.enrichments && Object.keys(input.enrichments.enrichments).length > 0,
    prProxy: records.some((r) => (r.prsMergedGit ?? 0) > 0),
    rework: records.some((r) => (r.reworkLines ?? 0) > 0),
  };

  // Members are whoever has a record in the window (a zero-commit holder still shows, with nulls).
  const byMember = new Map<string, UserWeekRepoRecord[]>();
  for (const r of records) {
    if (!windowSet.has(r.week) && !baselineSet.has(r.week)) continue;
    const list = byMember.get(r.member) ?? [];
    list.push(r);
    byMember.set(r.member, list);
  }

  const rows: ScorecardRow[] = [];
  for (const [member, recs] of byMember) {
    if (!recs.some((r) => windowSet.has(r.week))) continue;
    const cur = windowStats(recs, windowSet, input.enrichments);
    const base = windowStats(recs, baselineSet, input.enrichments);
    const meta = recs.find((r) => windowSet.has(r.week))!;
    const cells = {} as Record<MetricKey, Cell>;
    for (const m of METRICS) {
      const value = metricValue(m.key, cur, sources);
      const b = metricValue(m.key, base, sources);
      cells[m.key] = { value, baseline: b, deltaPct: deltaPct(value, b), percentile: null };
    }
    rows.push({
      member, team: meta.team, org: meta.org, orgType: meta.orgType,
      activeWeeks: cur.activeWeeks, baselineActiveWeeks: base.activeWeeks, cells, score: null,
    });
  }

  // Percentiles within the cohort (only when the cohort is large enough to mean anything).
  const minN = settings.scorecard_min_n;
  for (const m of METRICS) {
    const present = rows.filter((r) => r.cells[m.key].value !== null);
    if (present.length < minN) continue;
    const values = present.map((r) => r.cells[m.key].value as number);
    for (const r of present) {
      const v = r.cells[m.key].value as number;
      const below = values.filter((x) => x < v).length;
      r.cells[m.key].percentile = values.length === 1 ? 100 : Math.round((100 * below) / (values.length - 1));
    }
  }

  // Opt-in composite.
  const weights = settings.scorecard_weights ?? {};
  const hasScore = Object.keys(weights).length > 0;
  if (hasScore) {
    for (const r of rows) {
      let num = 0;
      let den = 0;
      for (const m of METRICS) {
        const w = weights[m.key];
        const p = r.cells[m.key].percentile;
        if (!w || p === null) continue;
        num += w * (m.betterWhen === 'low' ? 100 - p : p);
        den += w;
      }
      r.score = den > 0 ? Math.round(num / den) : null;
    }
  }

  return { window, baseline, cohortSize: rows.length, minN, sources, metrics: METRICS, rows, hasScore };
}

/** Stable sort; null values always sort last regardless of direction. */
export function sortRows(rows: ScorecardRow[], key: MetricKey | 'member' | 'score', desc: boolean): ScorecardRow[] {
  const val = (r: ScorecardRow): number | string | null =>
    key === 'member' ? r.member : key === 'score' ? r.score : r.cells[key].value;
  return [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av === null && bv === null) return a.member.localeCompare(b.member);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') return desc ? bv.localeCompare(av) : av.localeCompare(bv);
    const diff = (av as number) - (bv as number);
    if (diff === 0) return a.member.localeCompare(b.member);
    return desc ? -diff : diff;
  });
}
```

Note on `testPct` expectation in the test: the window contains two records with 100 app ins + 10 app del and 50 test ins each → test% = 100 / (220 + 100) = 31. If `rollup` doc/filetype sums differ, fix the test fixture numbers rather than the formula.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/scorecard.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aggregator/scorecard.ts src/__tests__/scorecard.test.ts
git commit -m "feat(gitradar): scorecard aggregator with active-week normalisation, percentiles, opt-in composite

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Scorecard view component + dashboard tab

**Files:**
- Create: `src/views/components/scorecard-section.ts`
- Modify: `src/views/dashboard.ts` (`TabId`, `TABS`, state, `mapKey`, `buildHotkeyItems`, render switch, action handlers)
- Test: `src/__tests__/scorecard-section.test.ts`

**Interfaces:**
- Consumes: `computeScorecard`, `sortRows`, `METRICS`, `FAMILIES` (Task 7); `renderTable`, `renderHotkeyBar`, `weekShort`, `fmt`.
- Produces:
  ```ts
  export type ScorecardMode = 'value' | 'delta' | 'pctl';
  export type ScorecardFamily = 'all' | Family;
  export interface ScorecardViewState { windowWeeks: 4 | 8 | 12; family: ScorecardFamily; mode: ScorecardMode; sortKey: MetricKey | 'member' | 'score'; sortDesc: boolean }
  export function defaultScorecardState(windowWeeks: 4 | 8 | 12): ScorecardViewState
  export function visibleMetricKeys(state: ScorecardViewState, hasScore: boolean): Array<MetricKey | 'member' | 'score'>
  export function moveSort(state: ScorecardViewState, dir: -1 | 1, hasScore: boolean): ScorecardViewState
  export function renderScorecard(sc: Scorecard, state: ScorecardViewState, termCols: number): string
  export function renderScorecardTab(ctx: ViewContext, state: ScorecardViewState, termCols: number): void
  export function buildScorecardHotkeys(state: ScorecardViewState): Array<{ key: string; label: string }>
  ```

- [ ] **Step 1: Write failing tests** — `src/__tests__/scorecard-section.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { computeScorecard } from '../aggregator/scorecard.js';
import { stripAnsi } from '../ui/format.js';
import {
  buildScorecardHotkeys, defaultScorecardState, moveSort, renderScorecard, visibleMetricKeys,
} from '../views/components/scorecard-section.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

const SETTINGS = { trend_threshold: 0.1, scorecard_min_n: 8, bot_patterns: [] as string[] };
function rec(member: string, commits: number, extra: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member, email: `${member}@co.com`, org: 'Acme', orgType: 'core', team: 'FE', tag: 'default',
    week: '2026-W12', repo: 'web', group: 'default', commits, activeDays: 2, activeDayMask: 0b11,
    intent: { feat: 1, fix: 1, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 }, breakingChanges: 0, scopes: [],
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 0 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...extra,
  };
}
const eight = Array.from({ length: 8 }, (_, i) => rec(`M${i}`, i + 1));
const sc = computeScorecard({ records: eight, currentWeek: '2026-W12', windowWeeks: 4, settings: SETTINGS });

describe('visibleMetricKeys / moveSort', () => {
  it('overview shows member + 10 core metrics (+ score when configured)', () => {
    const keys = visibleMetricKeys(defaultScorecardState(4), false);
    expect(keys[0]).toBe('member');
    expect(keys).toHaveLength(11);
    expect(visibleMetricKeys(defaultScorecardState(4), true)).toContain('score');
  });
  it('family pages show only that family', () => {
    const keys = visibleMetricKeys({ ...defaultScorecardState(4), family: 'flow' }, false);
    expect(keys).toEqual(['member', 'prSizeP50', 'prSizeP75', 'cycleHrs']);
  });
  it('moveSort wraps around the visible columns', () => {
    let s = defaultScorecardState(4);
    expect(s.sortKey).toBe('commitsPerWeek');
    s = moveSort(s, -1, false);
    expect(s.sortKey).toBe('member');
    s = moveSort(s, -1, false);
    expect(s.sortKey).toBe('repos');
  });
});

describe('renderScorecard', () => {
  it('renders one row per member sorted by the sort key, with header labels', () => {
    const out = stripAnsi(renderScorecard(sc, defaultScorecardState(4), 160));
    expect(out).toContain('cmt/wk');
    const rows = out.split('\n').filter((l) => /\bM\d\b/.test(l));
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatch(/M7/); // highest commits first (desc)
  });
  it('shows n<8 for percentiles when the cohort is too small', () => {
    const small = computeScorecard({ records: eight.slice(0, 3), currentWeek: '2026-W12', windowWeeks: 4, settings: SETTINGS });
    const out = stripAnsi(renderScorecard(small, { ...defaultScorecardState(4), mode: 'pctl' }, 160));
    expect(out).toContain('n<8');
  });
  it('renders — for null cells and a sources footer', () => {
    const out = stripAnsi(renderScorecard(sc, defaultScorecardState(4), 160));
    expect(out).toMatch(/cycle[\s\S]*—/);
    expect(out).toMatch(/sources: rework –, PR proxy –, enrichment –/);
    expect(out).toMatch(/cohort 8/);
  });
  it('delta mode shows signed percentages with trend glyphs', () => {
    const withBase = computeScorecard({
      records: [...eight, rec('M7', 2, { week: '2026-W07' })],
      currentWeek: '2026-W12', windowWeeks: 4, settings: SETTINGS,
    });
    const out = stripAnsi(renderScorecard(withBase, { ...defaultScorecardState(4), mode: 'delta' }, 160));
    expect(out).toMatch(/M7.*▲\s*\+?300%/);
  });
});

describe('buildScorecardHotkeys', () => {
  it('lists window, family, mode, sort and reverse keys', () => {
    const keys = buildScorecardHotkeys(defaultScorecardState(8)).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(['1/2/3', 'F', 'N', '←/→', 'R']));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/scorecard-section.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/views/components/scorecard-section.ts`**

```ts
import chalk from 'chalk';
import {
  computeScorecard, FAMILIES, METRICS, sortRows,
  type Cell, type Family, type MetricDef, type MetricKey, type Scorecard,
} from '../../aggregator/scorecard.js';
import { filterRecords } from '../../aggregator/filters.js';
import { fmt, weekShort } from '../../ui/format.js';
import { type Column, renderTable } from '../../ui/table.js';
import type { ViewContext } from '../types.js';

export type ScorecardMode = 'value' | 'delta' | 'pctl';
export type ScorecardFamily = 'all' | Family;
export type SortKey = MetricKey | 'member' | 'score';

export interface ScorecardViewState {
  windowWeeks: 4 | 8 | 12;
  family: ScorecardFamily;
  mode: ScorecardMode;
  sortKey: SortKey;
  sortDesc: boolean;
}

export function defaultScorecardState(windowWeeks: 4 | 8 | 12): ScorecardViewState {
  return { windowWeeks, family: 'all', mode: 'value', sortKey: 'commitsPerWeek', sortDesc: true };
}

export function visibleMetricKeys(state: ScorecardViewState, hasScore: boolean): SortKey[] {
  const metrics = state.family === 'all'
    ? METRICS.filter((m) => m.core)
    : METRICS.filter((m) => m.family === state.family);
  const keys: SortKey[] = ['member', ...metrics.map((m) => m.key)];
  if (hasScore) keys.push('score');
  return keys;
}

export function moveSort(state: ScorecardViewState, dir: -1 | 1, hasScore: boolean): ScorecardViewState {
  const keys = visibleMetricKeys(state, hasScore);
  const idx = Math.max(0, keys.indexOf(state.sortKey));
  const next = keys[(idx + dir + keys.length) % keys.length];
  return { ...state, sortKey: next, sortDesc: next === 'member' ? false : state.sortDesc };
}

export const FAMILY_ORDER: ScorecardFamily[] = ['all', ...FAMILIES];
export const MODE_ORDER: ScorecardMode[] = ['value', 'delta', 'pctl'];

// ── Cell formatting ───────────────────────────────────────────────────────────

const NULL = chalk.dim('—');

function fmtValue(m: MetricDef, v: number | null): string {
  if (v === null) return NULL;
  switch (m.format) {
    case 'int': return fmt(Math.round(v));
    case 'dec1': return v.toFixed(1);
    case 'pct': return `${Math.round(v)}%`;
    case 'ratio': return v.toFixed(2);
    case 'hours': return v >= 24 ? `${(v / 24).toFixed(1)}d` : `${v.toFixed(1)}h`;
  }
}

function colorFor(m: MetricDef, good: boolean | null): (s: string) => string {
  if (good === null || m.betterWhen === 'neutral') return chalk.dim;
  return good ? chalk.green : chalk.red;
}

function fmtDelta(m: MetricDef, c: Cell, threshold: number): string {
  if (c.deltaPct === null) return NULL;
  const within = Math.abs(c.deltaPct) <= threshold * 100;
  const up = c.deltaPct > 0;
  const glyph = within ? '○' : up ? '▲' : '▼';
  const good = within ? null : m.betterWhen === 'high' ? up : m.betterWhen === 'low' ? !up : null;
  return colorFor(m, good)(`${glyph} ${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}%`);
}

function fmtPctl(m: MetricDef, c: Cell, minN: number): string {
  if (c.value === null) return NULL;
  if (c.percentile === null) return chalk.dim(`n<${minN}`);
  const good = m.betterWhen === 'high' ? c.percentile >= 50 : m.betterWhen === 'low' ? c.percentile <= 50 : null;
  return colorFor(m, good)(`p${c.percentile}`);
}

function trendGlyph(m: MetricDef, c: Cell, threshold: number): string {
  if (c.deltaPct === null) return ' ';
  const within = Math.abs(c.deltaPct) <= threshold * 100;
  if (within) return chalk.dim('○');
  const up = c.deltaPct > 0;
  const good = m.betterWhen === 'high' ? up : m.betterWhen === 'low' ? !up : null;
  return colorFor(m, good)(up ? '▲' : '▼');
}

// ── Rendering ─────────────────────────────────────────────────────────────────

export function renderScorecard(sc: Scorecard, state: ScorecardViewState, termCols: number, trendThreshold = 0.1): string {
  const lines: string[] = [];
  const w = sc.window;
  const title = `Scorecard · ${state.family === 'all' ? 'overview' : state.family} · ${state.mode}`;
  lines.push(`${chalk.bold(title)}  ${chalk.dim(`${weekShort(w[0])} → ${weekShort(w[w.length - 1])}`)}`);
  lines.push('');

  if (sc.rows.length === 0) {
    lines.push(chalk.dim('  No contributors in this window.'));
    return lines.join('\n');
  }

  const keys = visibleMetricKeys(state, sc.hasScore);
  const defs = new Map(METRICS.map((m) => [m.key, m]));
  const columns: Column[] = [{ key: 'member', label: 'Name', minWidth: 12, flex: 1 }, { key: 'team', label: 'Team', minWidth: 8 }];
  const rows: Record<string, string>[] = [];

  for (const k of keys) {
    if (k === 'member') continue;
    if (k === 'score') { columns.push({ key: 'score', label: 'score', align: 'right', minWidth: 6 }); continue; }
    const m = defs.get(k)!;
    const mark = state.sortKey === k ? (state.sortDesc ? '▾' : '▴') : '';
    if (state.family === 'all') {
      columns.push({ key: k, label: `${m.label}${mark}`, align: 'right', minWidth: Math.max(7, m.label.length + 2) });
    } else {
      columns.push({ key: k, label: `${m.label}${mark}`, align: 'right', minWidth: 8 });
      columns.push({ key: `${k}:d`, label: 'Δ', align: 'right', minWidth: 7 });
      columns.push({ key: `${k}:p`, label: 'pctl', align: 'right', minWidth: 5 });
    }
  }

  for (const r of sortRows(sc.rows, state.sortKey, state.sortDesc)) {
    const row: Record<string, string> = { member: r.member, team: chalk.dim(r.team) };
    if (sc.hasScore) row.score = r.score === null ? NULL : chalk.bold(String(r.score));
    for (const k of keys) {
      if (k === 'member' || k === 'score') continue;
      const m = defs.get(k)!;
      const c = r.cells[k];
      if (state.family === 'all') {
        row[k] = state.mode === 'value'
          ? `${fmtValue(m, c.value)}${trendGlyph(m, c, trendThreshold)}`
          : state.mode === 'delta' ? fmtDelta(m, c, trendThreshold) : fmtPctl(m, c, sc.minN);
      } else {
        row[k] = fmtValue(m, c.value);
        row[`${k}:d`] = fmtDelta(m, c, trendThreshold);
        row[`${k}:p`] = fmtPctl(m, c, sc.minN);
      }
    }
    rows.push(row);
  }

  lines.push(renderTable({ columns, rows, maxWidth: termCols, borderStyle: 'minimal' }));
  lines.push('');
  const b = sc.baseline;
  const src = (on: boolean) => (on ? '✓' : '–');
  lines.push(
    chalk.dim(
      `  cohort ${sc.cohortSize} · baseline ${weekShort(b[0])} → ${weekShort(b[b.length - 1])} · ` +
        `sources: rework ${src(sc.sources.rework)}, PR proxy ${src(sc.sources.prProxy)}, enrichment ${src(sc.sources.enrichment)}` +
        (sc.cohortSize < sc.minN ? ` · percentiles need n≥${sc.minN}` : ''),
    ),
  );
  lines.push(chalk.dim('  ▲▼ vs own previous window · ○ within threshold · — no data · bots excluded'));
  return lines.join('\n');
}

export function renderScorecardTab(ctx: ViewContext, state: ScorecardViewState, termCols: number): void {
  const s = ctx.config.settings;
  const sc = computeScorecard({
    records: filterRecords(ctx.records, {}),
    enrichments: ctx.enrichments,
    currentWeek: ctx.currentWeek,
    windowWeeks: state.windowWeeks,
    settings: { trend_threshold: s.trend_threshold, scorecard_min_n: s.scorecard_min_n, scorecard_weights: s.scorecard_weights, bot_patterns: s.bot_patterns },
  });
  console.log(renderScorecard(sc, state, termCols, s.trend_threshold));
}

export function buildScorecardHotkeys(state: ScorecardViewState): Array<{ key: string; label: string }> {
  return [
    { key: '1/2/3', label: `${state.windowWeeks}w` },
    { key: 'F', label: state.family === 'all' ? 'Family' : state.family },
    { key: 'N', label: state.mode },
    { key: '←/→', label: `sort: ${state.sortKey}` },
    { key: 'R', label: state.sortDesc ? 'desc' : 'asc' },
  ];
}
```

- [ ] **Step 4: Wire the tab in `src/views/dashboard.ts`**

- `type TabId = 'contributions' | 'repo_activity' | 'top_performers' | 'scorecard' | 'manage';`
- `TABS`: insert `{ id: 'scorecard', key: 'k', label: 'Scorecard' }` before `manage`.
- Imports: `import { buildScorecardHotkeys, defaultScorecardState, FAMILY_ORDER, MODE_ORDER, moveSort, renderScorecardTab, type ScorecardViewState } from './components/scorecard-section.js';`
- State in `dashboardView`: `let scorecard: ScorecardViewState = defaultScorecardState(initialWindow);`
- `mapKey(...)`: add a `case 'scorecard':` returning `'sc_window_4' | 'sc_window_8' | 'sc_window_12'` for `1/2/3`, `'sc_family'` for `f`, `'sc_mode'` for `n`, `'sc_sort_left'`/`'sc_sort_right'` for `left`/`right`, `'sc_reverse'` for `r`. (The function signature does not need the state; the window checks mirror the leaderboard ones.)
- `buildHotkeyItems`: add `case 'scorecard': items.push(...buildScorecardHotkeys(scorecardState)); break;` — add a `scorecardState: ScorecardViewState` parameter at the end and pass `scorecard` at the call site.
- Render switch: `case 'scorecard': renderScorecardTab(ctx, scorecard, termCols); break;`
- Action handlers (next to the Top Performers window block):

```ts
      if (action === 'sc_window_4') { scorecard = { ...scorecard, windowWeeks: 4 }; continue; }
      if (action === 'sc_window_8') { scorecard = { ...scorecard, windowWeeks: 8 }; continue; }
      if (action === 'sc_window_12') { scorecard = { ...scorecard, windowWeeks: 12 }; continue; }
      if (action === 'sc_family') {
        const i = FAMILY_ORDER.indexOf(scorecard.family);
        scorecard = { ...scorecard, family: FAMILY_ORDER[(i + 1) % FAMILY_ORDER.length] };
        continue;
      }
      if (action === 'sc_mode') {
        const i = MODE_ORDER.indexOf(scorecard.mode);
        scorecard = { ...scorecard, mode: MODE_ORDER[(i + 1) % MODE_ORDER.length] };
        continue;
      }
      if (action === 'sc_sort_left') { scorecard = moveSort(scorecard, -1, !!ctx.config.settings.scorecard_weights); continue; }
      if (action === 'sc_sort_right') { scorecard = moveSort(scorecard, 1, !!ctx.config.settings.scorecard_weights); continue; }
      if (action === 'sc_reverse') { scorecard = { ...scorecard, sortDesc: !scorecard.sortDesc }; continue; }
```

Update the doc comment on `dashboardView` ("Four tabs") to five. `src/__tests__/views.test.ts` / `navigator.test.ts` may assert the tab count or labels — update them.

- [ ] **Step 5: Run tests + typecheck + manual smoke**

Run: `npx vitest run src/__tests__/scorecard-section.test.ts src/__tests__/views.test.ts && npm test && npx tsc --noEmit`
Expected: PASS. Smoke: `npx tsx src/cli.ts --demo`, press `k`, then `f`, `n`, `←`, `r`, `2`; the table re-renders each time and `q` quits.

- [ ] **Step 6: Commit**

```bash
git add src/views/components/scorecard-section.ts src/views/dashboard.ts src/__tests__/scorecard-section.test.ts src/__tests__/views.test.ts
git commit -m "feat(gitradar): Scorecard tab with family pages, value/delta/percentile modes and sortable columns

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `gitradar view scorecard` CLI command

**Files:**
- Create: `src/commands/scorecard.ts`
- Modify: `src/cli.ts` (register under `view`)
- Test: `src/__tests__/scorecard-command.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ScorecardCommandOptions { weeks?: number; family?: ScorecardFamily; sort?: SortKey; asc?: boolean; json?: boolean; filters?: Filters; settings?: ScorecardSettings & { trend_threshold: number }; records?: UserWeekRepoRecord[]; enrichments?: EnrichmentStore }
  export async function scorecard(options?: ScorecardCommandOptions): Promise<void>
  ```

- [ ] **Step 1: Write failing tests** — `src/__tests__/scorecard-command.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scorecard } from '../commands/scorecard.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

function rec(member: string, commits: number, team = 'FE'): UserWeekRepoRecord {
  return {
    member, email: `${member}@co.com`, org: 'Acme', orgType: 'core', team, tag: 'default',
    week: '2026-W12', repo: 'web', group: 'default', commits, activeDays: 1, activeDayMask: 1,
    intent: { feat: 1, fix: 0, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 }, breakingChanges: 0, scopes: [],
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 0 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
  };
}
const SETTINGS = { trend_threshold: 0.1, scorecard_min_n: 8, bot_patterns: [] as string[] };

describe('view scorecard', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z')); // inside 2026-W12
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('--json emits the full Scorecard object', async () => {
    await scorecard({ records: [rec('A', 4), rec('B', 2)], json: true, settings: SETTINGS, weeks: 4 });
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.cohortSize).toBe(2);
    expect(parsed.rows.map((r: { member: string }) => r.member)).toEqual(['A', 'B']);
    expect(parsed.rows[0].cells.commitsPerWeek.value).toBe(4);
  });

  it('renders a table honouring --sort/--asc and filters', async () => {
    await scorecard({ records: [rec('alpha', 4), rec('bravo', 2), rec('charlie', 9, 'BE')], settings: SETTINGS, weeks: 4, sort: 'commitsPerWeek', asc: true, filters: { team: 'FE' } });
    const text = out.join('\n');
    expect(text).toContain('cmt/wk');
    expect(text.indexOf('bravo')).toBeLessThan(text.indexOf('alpha'));
    expect(text).not.toContain('charlie');
  });

  it('prints the no-data hint when nothing is in the window', async () => {
    await scorecard({ records: [], settings: SETTINGS });
    expect(out.join('\n')).toMatch(/No contributors|Run "gitradar scan"/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/scorecard-command.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/scorecard.ts`**

```ts
import { type Filters, filterRecords, getCurrentWeek } from '../aggregator/filters.js';
import { computeScorecard, type ScorecardSettings } from '../aggregator/scorecard.js';
import { loadEnrichmentsSQL, queryRecords } from '../store/sqlite-store.js';
import type { EnrichmentStore, UserWeekRepoRecord } from '../types/schema.js';
import { printJson, printNoData } from '../ui/cli-renderer.js';
import {
  defaultScorecardState, renderScorecard, type ScorecardFamily, type SortKey,
} from '../views/components/scorecard-section.js';

export interface ScorecardCommandOptions {
  weeks?: number;
  family?: ScorecardFamily;
  sort?: SortKey;
  asc?: boolean;
  json?: boolean;
  filters?: Filters;
  settings?: ScorecardSettings;
  /** Pre-loaded records / enrichments (skips the DB — used by tests). */
  records?: UserWeekRepoRecord[];
  enrichments?: EnrichmentStore;
}

const DEFAULT_SETTINGS: ScorecardSettings = { trend_threshold: 0.1, scorecard_min_n: 8, bot_patterns: ['[bot]', 'dependabot', 'renovate', 'github-actions'] };

function toWindow(weeks: number | undefined): 4 | 8 | 12 {
  if (!weeks || weeks <= 4) return 4;
  if (weeks <= 8) return 8;
  return 12;
}

export async function scorecard(options: ScorecardCommandOptions = {}): Promise<void> {
  let records = options.records ?? queryRecords({});
  if (options.filters) records = filterRecords(records, options.filters);
  const enrichments = options.enrichments ?? (options.records ? undefined : loadEnrichmentsSQL());
  const settings = options.settings ?? DEFAULT_SETTINGS;

  const windowWeeks = toWindow(options.weeks);
  const sc = computeScorecard({ records, enrichments, currentWeek: getCurrentWeek(), windowWeeks, settings });

  if (sc.rows.length === 0) {
    printNoData('No contributors in this window. Run "gitradar scan" first.');
    return;
  }
  if (options.json) {
    printJson(sc);
    return;
  }

  const state = {
    ...defaultScorecardState(windowWeeks),
    family: options.family ?? 'all',
    sortKey: options.sort ?? 'commitsPerWeek',
    sortDesc: !options.asc,
  };
  console.log(renderScorecard(sc, state, process.stdout.columns || 120, settings.trend_threshold));
}
```

Register in `src/cli.ts` after the `leaderboard` command:

```ts
view
  .command('scorecard')
  .description('Per-member scorecard: throughput, flow, quality, collaboration')
  .option('-w, --weeks <n>', 'Window: 4, 8 or 12 weeks', parseInt)
  .option('--family <f>', 'all | throughput | flow | quality | collab', 'all')
  .option('--sort <metric>', 'Sort column (metric key, member, or score)', 'commitsPerWeek')
  .option('--asc', 'Ascending sort (default: descending)')
  .action(async (cmdOpts: { weeks?: number; family?: string; sort?: string; asc?: boolean }) => {
    const g = globals();
    const { scorecard } = await import('./commands/scorecard.js');
    const { loadConfig } = await import('./config/loader.js');
    const s = (await loadConfig(g.config)).settings;
    await scorecard({
      weeks: cmdOpts.weeks ?? g.weeks,
      family: cmdOpts.family as ScorecardFamily,
      sort: cmdOpts.sort as SortKey,
      asc: cmdOpts.asc,
      json: g.json,
      filters: globalFilters(),
      settings: { trend_threshold: s.trend_threshold, scorecard_min_n: s.scorecard_min_n, scorecard_weights: s.scorecard_weights, bot_patterns: s.bot_patterns },
    });
  });
```

(Import the two types with `import type { ScorecardFamily, SortKey } from './views/components/scorecard-section.js';`.) Validate `--family`/`--sort` against `FAMILY_ORDER` / `SCORECARD_METRIC_KEYS` and print `Error: unknown --sort <x>` with `process.exitCode = 1` on mismatch.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/scorecard-command.test.ts src/__tests__/cli.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/scorecard.ts src/cli.ts src/__tests__/scorecard-command.test.ts
git commit -m "feat(gitradar): view scorecard CLI command

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: CSV export columns, demo data, docs

**Files:**
- Modify: `src/commands/export-data.ts` (HEADERS + `flattenRecord`), `src/demo.ts`, `README.md`, `docs/feature-overview.md`, `docs/architecture.md`
- Test: `src/__tests__/export-data.test.ts`, `src/__tests__/demo.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/__tests__/export-data.test.ts` (use the file's existing record helper):

```ts
  it('exports PR-proxy and rework columns', () => {
    const csv = recordsToCsv([makeRecord({ prsMergedGit: 2, prSizes: [10, 30, 50], reworkLines: 7, reworkSelfLines: 3 })]);
    const [header, row] = csv.trim().split('\n');
    const h = header.split(',');
    const r = row.split(',');
    const col = (name: string) => r[h.indexOf(name)];
    expect(col('prs_merged_git')).toBe('2');
    expect(col('pr_size_p50')).toBe('30');
    expect(col('rework_lines')).toBe('7');
    expect(col('rework_self_lines')).toBe('3');
  });
```

In `src/__tests__/demo.test.ts`:

```ts
  it('gives demo records PR-proxy and rework data so the Scorecard tab has something to show', () => {
    const { records } = generateDemoData();
    expect(records.some((r) => (r.prsMergedGit ?? 0) > 0)).toBe(true);
    expect(records.some((r) => (r.reworkLines ?? 0) > 0)).toBe(true);
    for (const r of records) {
      expect(r.prSizes?.length ?? 0).toBe(r.prsMergedGit ?? 0);
      expect(r.reworkSelfLines ?? 0).toBeLessThanOrEqual(r.reworkLines ?? 0);
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/__tests__/export-data.test.ts src/__tests__/demo.test.ts`
Expected: both new tests FAIL.

- [ ] **Step 3: Implement**

`export-data.ts`: add to `HEADERS` after `churn_rate_pct`: `'prs_merged_git', 'pr_size_p50', 'rework_lines', 'rework_self_lines'`. In `flattenRecord` before `flat.segment = …`:

```ts
  const sizes = [...(r.prSizes ?? [])].sort((a, b) => a - b);
  flat.prs_merged_git = r.prsMergedGit ?? 0;
  flat.pr_size_p50 = sizes.length ? sizes[Math.max(0, Math.ceil(sizes.length / 2) - 1)] : 0;
  flat.rework_lines = r.reworkLines ?? 0;
  flat.rework_self_lines = r.reworkSelfLines ?? 0;
```

`demo.ts`: after the `activeDayMask` line add

```ts
            // PR proxy: 0-3 merged PRs, sized 20-400 lines; rework: 0-15% of inserted lines
            const prsMergedGit = Math.floor(rand() * 4);
            const prSizes = Array.from({ length: prsMergedGit }, () => 20 + Math.floor(rand() * 380));
            const insertedTotal = appFiles * insPerFile + testFiles * Math.round(insPerFile * 0.7);
            const reworkLines = Math.round(insertedTotal * rand() * 0.15);
            const reworkSelfLines = Math.round(reworkLines * rand());
```

and add `prsMergedGit, prSizes, reworkLines, reworkSelfLines,` to the pushed record after `activeDayMask`.

Docs:
- `README.md`: add `Scorecard tab` to "What You Get" (`Per-member scorecard — throughput, flow, quality, collaboration; each metric vs the member's own baseline and the cohort percentile; opt-in weighted score`), the CLI line `gitradar view scorecard -w 8 --family quality`, the `--skip-rework` flag, and a "Scorecard Tab" keyboard table (`1/2/3`, `F`, `N`, `←/→`, `R`).
- `docs/feature-overview.md`: new `### Tab K: Scorecard` under §2 describing the four families, the three modes, `n<8`, sources footer, bots, and weights; new `## 15. PR Proxy & Rework Collection` explaining first-parent detection rules, the blind spot, blame window (`churn_window_days`), `--skip-rework` / `rework_enabled`; §13 settings block gains `rework_enabled`, `scorecard_min_n`, `scorecard_weights`, `bot_patterns`, `segment_min_n`; §11 Segment Filtering notes the min-N rule and bot exclusion.
- `docs/architecture.md`: add `collector/pr-proxy.ts`, `collector/rework.ts`, `aggregator/scorecard.ts`, `aggregator/bots.ts` to the layer map and the four new `records` columns to the data model.

- [ ] **Step 4: Run the full suite, typecheck, format**

Run: `npm test && npx tsc --noEmit && (cd ../.. && npx biome check --write apps/gitradar)`
Expected: green; biome clean.

- [ ] **Step 5: Commit**

```bash
git add src/commands/export-data.ts src/demo.ts README.md docs src/__tests__/export-data.test.ts src/__tests__/demo.test.ts
git commit -m "feat(gitradar): scorecard CSV columns, demo data and docs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (after Task 10)

- [ ] `npm test`, `npx tsc --noEmit`, `npx biome check apps/gitradar` (from repo root) all clean.
- [ ] `gitradar --reset` then `gitradar scan` on a real workspace: scan log shows `rework: N commits, M blames` and `(N ignored-only)`; `gitradar view scorecard --json | head` shows non-null `prsPerWeek`/`reworkPct` where the repo has merged PRs.
- [ ] `gitradar --demo` → `k` tab renders; `gitradar view scorecard` renders a table.
