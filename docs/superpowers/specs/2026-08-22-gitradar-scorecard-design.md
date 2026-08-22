# GitRadar Scorecard — Design

**Date:** 2026-08-22
**Scope:** `apps/gitradar`
**Status:** approved in conversation; this document is the written record.

## 1. Problem

GitRadar's performance surfaces (Top Performers tab, segments, running averages) all rank
people by `insertions + deletions`. The better signals it already stores — conventional-commit
intent, breaking changes, scopes, active days, GitHub PR/review/cycle/churn enrichment — are
never shown per person. The app also lacks any PR throughput or rework signal for repos
without a GitHub token, and hands out "low performer" labels on teams too small for the
label to mean anything.

## 2. Decisions (made with the user)

| Decision | Choice |
|---|---|
| Placement in TUI | New **5th tab** `Scorecard`; Top Performers tab stays |
| New collection this round | **Git-only PR proxy + blame-based rework** ("even if slower I prefer better data") |
| Composite score | **Opt-in** via `settings.scorecard_weights`; no default composite |
| Collection architecture | Scan-integrated post-pass, incremental on new hashes (approach A) |

Rejected for now: a separate enrichment-style rework command (re-blames the whole window
every run); a per-commit fact table (right long-term shape, too large for this round).

## 3. Collection

### 3.1 PR proxy (git only)

Runs per repo after the regular scan, for the same `since` range.

1. **Default branch**: `git symbolic-ref --short refs/remotes/origin/HEAD` → strip `origin/`;
   else `main` if it exists, else `master`, else skip the repo with a single warning
   (`  PR proxy: no default branch found for <repo>`).
2. **Log**: `git log --first-parent <branch> -m --format=%H|%P|%ae|%an|%aI|%s --numstat
   [--since=<since>]`. `-m` with `--first-parent` makes merge commits show their diff against
   the first parent (= the PR's net change).
3. **A first-parent commit is a merged PR when** it has ≥ 2 parents, **or** its subject matches
   one of: `/\(#\d+\)\s*$/` (GitHub squash), `/^Merge pull request #\d+/`, `/\(!\d+\)\s*$/`
   or `/See merge request .*!\d+/` (GitLab). Anything else (a direct push) is not a PR.
4. **PR author**: non-merge → commit author. Merge → author of the **second parent's tip**,
   fetched in one batched `git log --no-walk --format=%H|%ae|%an <p2…>`.
5. **PR size** = Σ (insertions + deletions) over files that pass the ignore matcher
   (lockfile-only PRs have size 0 and still count as a PR).
6. **Attribution**: `(member, ISO week of the first-parent commit's author date, repo)`.
   Author resolved through the normal author map / identifier rules; unresolved → `unassigned`.
7. **Dedup**: new per-repo `recentPrHashes` cursor in scan-state, rotated like
   `recentHashes`. `--force-scan`/`--reset` recompute from scratch.
8. **Known blind spot**: rebase-merge repos with no PR reference in the subject report
   0 PRs from the proxy; GitHub enrichment still covers them. The footer says which source
   is present.

### 3.2 Rework (blame)

During the regular scan, for each *counted* commit (not deduped, not ignored-only), collect
`{ hash, authorEmail, authorTime, week, repo, files: [{ path, deletions }] }` for files with
`deletions > 0` after the ignore matcher. Memory is bounded by commits in the scan.

Post-pass per repo with `p-limit(settings.churn_concurrency)`:

1. `git diff -U0 --no-color --diff-filter=MD C^ C -- <paths>` → per file, deleted hunks from
   `@@ -a,b +c,d @@` headers (`b > 0`; `b` omitted ⇒ 1).
2. One `git blame --porcelain -w -L a,b [-L …] C^ -- <path>` per (commit, file). Each blamed
   line yields `author-mail` and `author-time`.
3. A deleted line is **rework** when `authorTime(C) − author-time(line) ≤
   settings.churn_window_days` (default 21, reused). It is attributed to the line's
   **original author** in the **deletion week**: `rework_lines += 1`; additionally
   `rework_self_lines += 1` when the original author resolves to the same member as C's
   author.
4. If the original author has no record for `(member, week, repo)`, a zero-commit record is
   created to hold the rework counters (it does not count as an active week — active weeks
   require `commits > 0`).
5. Binary files and renames are skipped. Blame errors are classified with
   `classifyGitError`; fatal → surface, otherwise skip the file.
6. Root commits (no `C^`) are skipped.
7. Off switches: `gitradar scan --skip-rework` (also `gitradar --skip-rework`), and
   `settings.rework_enabled: false`. Progress: `  rework: <commits> commits, <blames> blames`.

Metric: `rework% = rework_lines / insertions` over the window (both from records).

## 4. Storage

### 4.1 `records` (migration v5)

| Column | Type | Upsert merge |
|---|---|---|
| `prs_merged_git` | INTEGER NOT NULL DEFAULT 0 | `+` |
| `pr_sizes` | TEXT NOT NULL DEFAULT '[]' (JSON array of ints) | JSON concat via `json_each` |
| `rework_lines` | INTEGER NOT NULL DEFAULT 0 | `+` |
| `rework_self_lines` | INTEGER NOT NULL DEFAULT 0 | `+` |

Zod `UserWeekRepoRecordSchema` gains the optional fields `prsMergedGit`, `prSizes`,
`reworkLines`, `reworkSelfLines`. `RolledUp` gains `prsMergedGit`, `prSizes` (concatenated),
`reworkLines`, `reworkSelfLines` in both `rollup()` and `queryRollup()` (sizes via a second
query using `json_each`, same pattern as active days). CSV export gains the four columns.

### 4.2 `scan_state` (migration)

`recent_pr_hashes TEXT NOT NULL DEFAULT '[]'`; `ScanStateSchema.repos[*].recentPrHashes`
optional array.

## 5. Scorecard aggregator — `src/aggregator/scorecard.ts` (pure)

```ts
computeScorecard(input: {
  records: UserWeekRepoRecord[];     // already filtered by org/team/tag/group
  enrichments?: EnrichmentStore;
  currentWeek: string;
  windowWeeks: 4 | 8 | 12;
  settings: Pick<Config['settings'], 'trend_threshold' | 'scorecard_min_n' | 'scorecard_weights' | 'bot_patterns'>;
}): Scorecard
```

```ts
interface Scorecard {
  window: string[]; baseline: string[];     // ISO weeks
  cohortSize: number; minN: number;
  sources: { enrichment: boolean; prProxy: boolean; rework: boolean };
  metrics: MetricDef[];                     // ordered, with family + betterWhen
  rows: ScorecardRow[];                     // one per non-bot member
}
interface ScorecardRow {
  member: string; team: string; org: string; orgType: 'core' | 'consultant';
  activeWeeks: number; baselineActiveWeeks: number;
  cells: Record<MetricKey, Cell>;
  score?: number;                           // only when weights configured
}
interface Cell { value: number | null; baseline: number | null; deltaPct: number | null; percentile: number | null }
```

### 5.1 Metrics

| key | family | label | definition (window) | betterWhen |
|---|---|---|---|---|
| `commitsPerWeek` | throughput | `cmt/wk` | commits ÷ activeWeeks | high |
| `daysPerWeek` | throughput | `days/wk` | activeDays (mask-aware rollup) ÷ activeWeeks | high |
| `prsPerWeek` | throughput | `PRs/wk` | prsMergedGit ÷ activeWeeks | high |
| `prSizeP50` | flow | `PR p50` | median of prSizes | low |
| `prSizeP75` | flow | `PR p75` | 75th percentile of prSizes | low |
| `cycleHrs` | flow | `cycle` | PR-count-weighted mean of enrichment `avg_cycle_hrs` (which is a per-week median) | low |
| `reworkPct` | quality | `rework%` | reworkLines ÷ insertions × 100 | low |
| `fixToFeat` | quality | `fix:feat` | intent.fix ÷ intent.feat (`null` when feat = 0) | neutral |
| `testPct` | quality | `test%` | existing `testPct()` | neutral |
| `breaking` | quality | `brk` | Σ breakingChanges | neutral |
| `reviews` | collab | `reviews` | Σ enrichment reviews_given | high |
| `reviewsPerPr` | collab | `rev/PR` | reviews ÷ max(prsMergedGit, enrichment prs_opened) (`null` if denominator 0) | high |
| `repos` | collab | `repos` | distinct repos with commits > 0 | neutral |
| `scopes` | collab | `scopes` | distinct conventional-commit scopes | neutral |

*Overview core set* (10): `commitsPerWeek`, `daysPerWeek`, `prsPerWeek`, `prSizeP50`,
`cycleHrs`, `reworkPct`, `fixToFeat`, `testPct`, `reviews`, `repos`.

### 5.2 Normalisation

- **Active week** = a week in the window where the member has `commits > 0` in any repo.
  Per-week metrics return `null` when activeWeeks = 0.
- **Baseline** = the same metric over the `windowWeeks` weeks immediately preceding the
  window. `deltaPct = (value − baseline) / |baseline| × 100`; `null` when either side is null
  or baseline = 0. Trend glyph: `▲`/`▼` beyond `trend_threshold`, `○` within.
- **Percentile** = among cohort members whose cell value is non-null:
  `100 × (count of values strictly below) / (n − 1)`, rounded (`100` when n = 1); `null`
  when `n < scorecard_min_n` (rendered `n<8`). Raw percentile is never direction-flipped.
- **Colour** of Δ and percentile follows `betterWhen` (neutral → dim).
- **Composite** only when `settings.scorecard_weights` is non-empty:
  `adj = betterWhen === 'low' ? 100 − pctl : pctl`; `score = Σ wᵢ·adjᵢ / Σ wᵢ` over metrics
  with a non-null percentile. Unknown metric keys in the weights map are a config error
  (zod refinement). `score` is `null` when no weighted metric has a percentile.

### 5.3 Bots

`settings.bot_patterns` (default `["[bot]", "dependabot", "renovate", "github-actions"]`),
case-insensitive substring match against member name **or** email. `isBotAuthor()` lives in
`src/aggregator/bots.ts`. Bots are excluded from scorecard rows and cohort, and from the
member totals fed to `calculateSegments` at its four call sites (contribution-section,
leaderboard, contributions, export-data).

## 6. Segments guardrail

`calculateSegments(totals, thresholds, minN = settings.segment_min_n /* default 8 */)`:
when `totals.size < minN`, every member is `middle` — no high/low labels. The previous
small-N fallback (top 1 / bottom 1) is removed; its tests are rewritten to the new policy.
Zero-value members remain `low` only when `n ≥ minN`.

## 7. TUI

- `TABS` gains `{ id: 'scorecard', key: 'k', label: 'Scorecard' }` (`s` is taken by the
  segment menu on Contributions; Tab cycling reaches it regardless).
- State: `scorecardWindowWeeks: 4|8|12` (shares the existing `WindowSize` default),
  `scorecardFamily: 'all' | 'throughput' | 'flow' | 'quality' | 'collab'`,
  `scorecardMode: 'value' | 'delta' | 'pctl'`, `scorecardSortKey`, `scorecardSortDesc`.
- Keys on the tab: `1/2/3` window; `F` cycle family; `N` cycle mode; `←/→` move sort
  column; `R` reverse; `Q` quit.
- **Overview** (`all`): `Name · Team · <10 core metrics>` each rendered as `value glyph`
  (mode `value`), `Δ%` (mode `delta`) or `pNN` (mode `pctl`); `score` column appended when
  weights are configured. Bots absent.
- **Family page**: every metric of the family as three columns `value | Δ | pctl`.
- Footer: `cohort N · window <w1 → w2> · baseline <b1 → b2> · sources: rework ✓/–, PR proxy
  ✓/–, enrichment ✓/–` and the min-N note when percentiles are suppressed.
- Rendering lives in `src/views/components/scorecard-section.ts`; the table uses the
  existing `renderTable` with `maxWidth`.

## 8. CLI

`gitradar view scorecard [-w <4|8|12>] [--family <f>] [--sort <metricKey>] [--desc|--asc]
[--json]`, honouring the global `--org/--team/--tag/--group` filters. `--json` emits the
full `Scorecard` object. Implementation in `src/commands/scorecard.ts`, following
`commands/leaderboard.ts` conventions (`records` option for tests, `printNoData`).

## 9. Settings additions (`ConfigSchema.settings`)

| key | default |
|---|---|
| `rework_enabled` | `true` |
| `scorecard_min_n` | `8` |
| `scorecard_weights` | `undefined` (record of metricKey → positive number) |
| `bot_patterns` | `["[bot]", "dependabot", "renovate", "github-actions"]` |
| `segment_min_n` | `8` |

`DEFAULT_SETTINGS` and the zod `.default({...})` literal gain the same keys.

## 10. Files

New: `src/collector/pr-proxy.ts`, `src/collector/rework.ts`, `src/aggregator/scorecard.ts`,
`src/aggregator/bots.ts`, `src/views/components/scorecard-section.ts`,
`src/commands/scorecard.ts`, matching tests, `src/__tests__/sqlite-scorecard.test.ts` (bun,
sandboxed via `GITRADAR_HOME`).

Modified: `collector/git.ts` (collect rework inputs; `ScanResult` gains `reworkInputs`,
`prProxy` result), `collector/index.ts` (run post-passes, progress lines, scan-state cursor),
`store/sqlite-store.ts` (columns, migrations, upsert merges, rollup fields),
`store/scan-state.ts`, `types/schema.ts`, `aggregator/engine.ts`, `aggregator/segments.ts`
+ four callers, `views/dashboard.ts`, `cli.ts`, `commands/export-data.ts`, `demo.ts`
(synthetic PR sizes / rework so `--demo` exercises the tab), docs (README,
feature-overview, architecture).

## 11. Testing strategy

- **Parsers** (pure, vitest): first-parent log lines incl. merge/squash detection, diff
  hunk headers, blame porcelain, default-branch resolution.
- **Post-passes** (vitest, mocked `spawn`/`simple-git` like `scanRepo` tests): PR
  attribution to second-parent author, size excludes ignored files, dedup via
  `recentPrHashes`; rework attribution to original author in deletion week, self vs other,
  window threshold, zero-commit holder record, root-commit skip.
- **Store** (bun, `GITRADAR_HOME`): migration v5 on a legacy DB, additive upserts incl. JSON
  concat of `pr_sizes`, `queryRollup` returns the four new fields, scan-state cursor
  round-trip.
- **Aggregator** (vitest, table-driven): active-week normalisation, baseline Δ, percentile
  formula and `n<minN` suppression, direction-aware composite and weight validation, bot
  exclusion, null handling for missing sources.
- **Segments**: new min-N policy; callers drop bots.
- **View/CLI**: column set per family/mode, sort order and reverse, footer sources line,
  `--json` shape. No snapshot files.

## 12. Out of scope (follow-ups)

Per-commit fact table; bulk-commit flagging; GitHub enrichment v2 (review submissions,
time-to-first-review, merge-week attribution); a scorecard strip in Member Detail; honouring
`.gitattributes linguist-generated`.
