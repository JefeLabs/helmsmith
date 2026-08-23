# GitRadar Roadmap

Last updated: 2026-08-23 (after the Scorecard feature landed on `main` at `e57dc96`).

This is the prioritised cleanup/improvement backlog from the 2026-08 critical review
(four audit lenses: metric correctness, CLI/config/docs, structure/dead code, tests/tooling).
Items are ordered by damage done, not effort. File references are to the tree at `e57dc96`.

## Wave 1 done (2026-08-23)

Branch `feat/gitradar-roadmap-wave1` closed out the Parked follow-ups, all of Tier 1
except the reverts/`Co-authored-by`-trailers/cherry-picks item, and all of Tier 2 — see
the checkmarks below. Tier 3 and Tier 4 were not attempted (Tier 3's `commander` removal
from `package.json` is the one exception, folded into this wave's packaging pass).

## Recently done (for context)

- Ignore rules: expanded defaults (lockfiles, `node_modules/`, build/cache dirs, generated
  files), additive `ignore_patterns`, ignored-only commits no longer count as commits/active days.
- `activeDays` no longer over-counts across repos (weekday bitmask, mask-aware rollups).
- Scorecard: git-only merged-PR proxy, blame-based rework, `aggregator/scorecard.ts`
  (14 metrics × value / Δ vs own baseline / cohort percentile, opt-in composite), Scorecard
  tab (`K`) + `view scorecard` CLI, bot exclusion, segment min-N guardrail, tab hotkeys.
- `GITRADAR_HOME` override for sandboxed store tests.

## Parked follow-ups from the Scorecard review

- [x] `src/collector/index.ts`: rework window bound is `weeks_back * 2`; the Scorecard can
      always reach a 12-week window + 12-week baseline. Use `Math.max(weeks_back, 12) * 2`.
- [x] `src/views/dashboard.ts` TUI CSV export message reports the pre-bot-exclusion row count.
- [x] `src/views/components/contribution-section.ts` by-entity (pivot) segmentation builds
      entity totals without the `commits > 0` holder-record gate.
- [x] `commands/repo-activity.ts` passes no `botPatterns` to `queryRollup` (repo grouping; low impact).

## Tier 1 — wrong numbers or corrupted data

- [x] **Top Performers tab never excludes bots** — `views/components/top-performers-section.ts:94`
      passes `ctx.records` straight to `computeLeaderboard`. Apply `excludeBots` like every other surface.
- [x] **`assign-author` hard-codes `orgType: 'core'`** (`commands/assign-author.ts:48,92`) — derive from
      `config.orgs`. **`reattributeRecordsSQL` never updates `member`** (`store/sqlite-store.ts:1263-1282`)
      so SQL-path rollups keep the stale name after a reassignment — extend the UPDATE (or key by email).
- [x] **`--force-scan` is still incremental** — `collector/index.ts:91,109-118` only bypasses the staleness
      skip; `since` and `recentHashes`/`recentPrHashes` are still applied. Either clear cursors when forced
      (matching the help text "ignore cursors") or fix the help text.
- [x] **Holder records (commits = 0) inflate denominators** in `aggregator/trends.ts:110,160`
      (`computeRunningAvg*`), `views/member-detail.ts:174` (`computeSummary`), `views/team-detail.ts:39`
      (`buildMemberAvgBars`). Gate on `r.commits > 0` as `rollup()` already does.
- [x] **Active-day bit vs week bucket disagree near midnight** — `collector/git.ts:745-746`: `week` uses the
      UTC date, `dateDay` uses the author's local date. Derive both from the same normalised instant.
- [x] **`recentHashes` capped at 500** (`store/scan-state.ts:52-58`) — >500 commits inside the 1-day overlap
      double-count. Size the cap to the overlap or dedupe without a fixed cap.
- [x] **`doc` filetype omitted** from "+lines/wk" and "top contributor" sums — `views/member-detail.ts:174-179`,
      `views/team-detail.ts:43-51,99-107,192-200`. Route through `aggregator/metrics.ts`.
- [x] **Enrichment fields are mislabeled**: `reviews_given` = PRs you ever reviewed that had *any* update in
      the window (`collector/github.ts:410,458`); `avg_cycle_hrs` is a median (`github.ts:65-84`);
      `churn_rate_pct` is file-collision, and fast vs deep modes disagree on self-edits
      (`collector/git.ts:970-1160`). Rename (`prs_reviewed_touched`, `median_cycle_hrs`,
      `file_collision_pct`) with a CSV header note, or drop churn in favour of `rework%`.
- [ ] **Deferred — not attempted in wave 1.** Reverts count as positive work (`git.ts:186-197`);
      `Co-authored-by` trailers ignored; cherry-picks double-count (new hash). Flag reverts; parse
      trailers; consider patch-id dedup.
- [x] Contributions "Avg" baseline includes the current bucket (`contribution-section.ts:350-395`) — label it
      as trailing-incl-current or exclude the current bucket.

## Tier 2 — the app says things that aren't true

- [x] **`config.yml` `repos:` is dead** — parsed by `config/loader.ts:16-73`, discarded by
      `engine/gitradar-engine.ts:148-211,891-907` (repos come only from `~/.agentx/repos.yml`). Wire it in or
      remove it from schema + README.
- [x] **Getting-started dead ends**: `gitradar data enrich` (real: `gitradar enrich`), `workspace use`,
      `repo add --name`, `max_scan_age_weeks`. README links `docs/feature-tour.md` (file is
      `feature-overview.md`). Test-count claims differ between README and architecture.md.
- [x] **Runtime truth**: docs say Node + better-sqlite3; code imports `bun:sqlite`, `bin/gitradar` execs the
      vendored bun, `bun` is a *dependency* with no `engines`. Decide (Bun-only, documented; or abstract the
      store) and make package.json/README/getting-started agree.
- [x] **`gitradar view trends` runs a full scan + enrich + TUI** (`cli.ts:510-515`) while documented as a
      non-interactive report — hangs in CI/pipes. Make it report-only or move it out of that section.
- [x] `--prune` is days in README/CLI and weeks in feature-overview; `auto_prune_weeks` is weeks. Pick one.
- [x] Segment menu hard-codes "top/bottom 20%" (`dashboard.ts:722,728`) regardless of
      `segment_high_pct`/`segment_low_pct`; Contributions segments are still volume-based while Scorecard
      percentiles exist — offer the scorecard percentile as a segment source.
- [x] `H` (hide unassigned) defaults on, so a fresh install with no org mapping looks empty; troubleshooting
      docs don't mention it. Default off until at least one author is assigned, or say so in the empty state.
- [x] Corrupt DB surfaces as a raw stack trace (`cli.ts:604-607`) — catch and point at `gitradar --reset`.
- [x] Top Performers vs Scorecard: no in-app or doc guidance on which to use. Consider retiring Top Performers
      or relabelling it "Volume".
- [x] Defaults declared three times in `types/schema.ts` (per-field, whole-object `.default`, `DEFAULT_SETTINGS`);
      `repos.yml` validation errors drop zod detail that `config.yml` errors keep.

## Tier 3 — structure and dead code

**Deferred — not attempted in wave 1**, except one item: `commander` was removed from
`package.json` `dependencies` as part of the wave-1 packaging pass (it remains available
transitively through `@helmsmith/cli-kit`).

Delete (zero callers confirmed): `loadCommitsDataSQL`, `saveCommitsDataSQL`, `resetDB`, `getStoreStatsSQL`,
`saveEnrichmentSQL` (`store/sqlite-store.ts`); `views/repo-activity.ts` (`repoActivityView`, 418 lines);
`computeRunningAvgByOrg` (`aggregator/trends.ts:129`); `parseGitLogOutput` from production
(`collector/git.ts:235-360`, test-only oracle); `commander` from `package.json`. Remove the legacy
`*.json` stores left in `~/.agentx/gitradar/data/` on `--reset`.

Consolidate: ~90 inlined `ins + del` filetype sums while `aggregator/metrics.ts` exists and
`calculateDerived` has zero callers; one glob compiler for `buildIgnoreMatcher`/`buildClassifier`
(`collector/classifier.ts:73-222`); one `recordKey(member, week, repo)` helper (built in
`aggregator/scorecard.ts`, `engine/gitradar-engine.ts`, `views/components/contribution-section.ts`).

Split: `dashboardView` (`views/dashboard.ts:405-1702`) — keep render + key dispatch; move author
reassignment (L915-1232), org/team CRUD (L1326-1599), directory scan (L1232-1326) and export (L1599-1690)
into the existing `commands/*` handlers so the TUI and CLI share one path. `contribution-section.ts`
(1,500 lines) → model vs view. `sqlite-store.ts` (1,337 lines) → one module per table with a typed row
mapper (73 `as number` casts today). Finish or drop the `@deprecated` on `GitRadarEngine.records`
(12 TUI files still read `ctx.records`).

## Tier 4 — test honesty and tooling

**Deferred — not attempted in wave 1.**

- [ ] **`sqlite-store.test.ts` never imports `sqlite-store.ts`** — it tests a hand-copied schema that has
      already drifted (no `active_day_mask` merge). Rewrite against the exported functions in a
      `GITRADAR_HOME` sandbox.
- [ ] **`gitradar-engine.ts` is effectively untested** (`handleReset`, `handlePrune`, `enrich`);
      `cli.test.ts:274` "reset function is available" is `expect(true).toBe(true)`.
- [ ] `views/manage-tab.ts` has no tests; no import↔export round-trip; `test:e2e` targets an empty
      directory; CI never builds `dist` or runs `bin/gitradar`.
- [ ] `github.test.ts` spends a real ~1 s `setTimeout` (15% of vitest wall time, flake-prone) — fake timers.
- [ ] 13 byte-identical `makeRecord` fixtures — one shared fixtures module.
- [ ] Add a package-scoped `biome check apps/gitradar` CI gate while the package is clean.
- [ ] Consider `noUncheckedIndexedAccess` in tsconfig.

## Suggested order

1. Tier 1 data-integrity items (each is a failing test + a few lines).
2. Tier 2 "truth" items: runtime decision, `config.yml repos:`, getting-started, `view trends`, `--force-scan`.
3. Tier 3 deletes + `metrics.ts` consolidation (mechanical, zero behaviour change).
4. Tier 4 test honesty — before any large refactor.
5. The `dashboardView` split, on a green, honest suite.
6. Enrichment renames / churn retirement.

## Out of scope for now (ideas)

Per-commit fact table (would enable bulk-commit flagging, exact medians, reverts); GitHub enrichment v2
(review submissions, time-to-first-review, merge-week attribution); Member Detail scorecard strip;
honouring `.gitattributes linguist-generated`.
