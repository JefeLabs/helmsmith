import { access } from 'node:fs/promises';
import { getLastNWeeks } from '../aggregator/filters.js';
import {
  getRepoState,
  isStale,
  MAX_RECENT_HASHES,
  rotateHashes,
  updateRepoState,
} from '../store/scan-state.js';
import type { AuthorRegistry, Config, ScanState, UserWeekRepoRecord } from '../types/schema.js';
import { buildAuthorMap, buildIdentifierRules } from './author-map.js';
import { buildIgnoreMatcher } from './classifier.js';
import type { RawAuthor } from './git.js';
import { scanRepo } from './git.js';
import { runPrProxy } from './pr-proxy.js';
import { isAncestor, resolveHead } from './refs.js';
import { runRework } from './rework.js';

/**
 * Discovered authors from a single repo scan — includes repo context.
 */
export interface RepoDiscoveredAuthor extends RawAuthor {
  repoName: string;
}

/**
 * Result of scanning all repos.
 */
export interface ScanAllResult {
  allNewRecords: UserWeekRepoRecord[];
  updatedScanState: ScanState;
  /** All unique authors discovered across all scanned repos. */
  discoveredAuthors: RepoDiscoveredAuthor[];
  stats: {
    totalCommits: number;
    totalRecords: number;
    reposScanned: number;
    reposSkipped: number;
    reposMissing: number;
    /** Repos whose git run failed; nothing was written for them (#112). */
    reposFailed: number;
    totalPrs: number;
    totalReworkCommits: number;
  };
}

/**
 * Scan all repos from the config, producing new UserWeekRepoRecords.
 *
 * For each repo:
 * - Checks staleness (skips fresh repos unless forceScan is true)
 * - Checks that repo path exists on disk (warns and continues if missing)
 * - Calculates a "since" date (lastScanDate - 1 day overlap, or undefined for first scan)
 * - Runs scanRepo()
 * - Updates scan state with new hashes, lastHash, lastScanDate, recordCount
 *
 * Returns all new records, updated scan state, and aggregate stats.
 */
export async function scanAllRepos(
  config: Config,
  scanState: ScanState,
  options?: {
    forceScan?: boolean;
    stalenessMinutes?: number;
    chunkMonths?: number;
    /** Skip the blame-based rework pass even if rework_enabled is true. */
    skipRework?: boolean;
    /** Author registry for discovery-based resolution. */
    authorRegistry?: AuthorRegistry;
    /** Called after each repo completes. Enables per-repo persistence to bound memory. */
    onRepoScanned?: (records: UserWeekRepoRecord[]) => Promise<void>;
    /** Called after each repo's scan state is updated. Enables crash-safe resumption. */
    /** Called after each repo with the whole state and the repo just scanned, so callers can persist one row (#111). */
    onScanStateUpdated?: (state: ScanState, repoName: string) => Promise<void>;
    /** Called after each repo with newly discovered authors. Enables per-repo author persistence. */
    onAuthorsDiscovered?: (authors: RepoDiscoveredAuthor[]) => Promise<void>;
    /**
     * Called for each repo before scanning when forceScan is true — deletes the repo's
     * stored records and scan state so the forced scan replaces them from a clean slate.
     */
    onRepoReset?: (repoName: string) => Promise<void>;
  },
): Promise<ScanAllResult> {
  const forceScan = options?.forceScan ?? false;
  const stalenessMinutes = options?.stalenessMinutes ?? config.settings.staleness_minutes;

  const authorMap = buildAuthorMap(config, options?.authorRegistry);
  const identifierRules = buildIdentifierRules(config);

  const allNewRecords: UserWeekRepoRecord[] = [];
  const allDiscoveredAuthors: RepoDiscoveredAuthor[] = [];
  let currentState = scanState;
  let totalCommits = 0;
  let totalRecords = 0;
  let reposScanned = 0;
  let reposSkipped = 0;
  let reposMissing = 0;
  let reposFailed = 0;
  let totalPrs = 0;
  let totalReworkCommits = 0;

  for (const repo of config.repos) {
    const repoName = repo.name ?? repo.path.split('/').pop() ?? repo.path;
    const repoState = getRepoState(currentState, repoName);

    // Check staleness — skip if fresh (unless forceScan)
    if (!forceScan && !isStale(repoState, stalenessMinutes)) {
      const elapsed = repoState
        ? Math.round((Date.now() - new Date(repoState.lastScanDate).getTime()) / 60000)
        : 0;
      console.log(`· ${repoName}: fresh (${elapsed}m ago)`);
      reposSkipped++;
      continue;
    }

    // Check repo path exists
    try {
      await access(repo.path);
    } catch {
      console.log(`⚠ ${repoName}: path not found (${repo.path})`);
      reposMissing++;
      continue;
    }

    // A forced scan replaces the repo's records and cursors instead of scanning
    // incrementally on top of them — clear its stored records/scan-state first.
    if (forceScan) {
      await options?.onRepoReset?.(repoName);
    }

    // Cursor (#79). Resolved before the walk so a commit landing mid-scan is seen next time.
    //  - sinceRef: the tip of the last scan, when it is still reachable from HEAD — the walk
    //    is `HEAD ^lastTip`, so commits that reached the clone late (merged branches, pulls)
    //    are counted whatever their dates.
    //  - rewritten history (tip not reachable): full re-walk, recentHashes dedups it.
    //  - state from before tips existed: one last date walk with a full timestamp.
    //  - first or forced scan: no cursor at all.
    const head = await resolveHead(repo.path);
    let since: string | undefined;
    let sinceRef: string | undefined;
    if (!forceScan && repoState) {
      if (repoState.lastTip) {
        if (head && (await isAncestor(repo.path, repoState.lastTip, head))) {
          sinceRef = repoState.lastTip;
        } else {
          console.log(
            `  ${repoName}: history rewritten since the last scan; re-walking with hash dedup`,
          );
        }
      } else if (repoState.lastScanDate) {
        const lastScan = new Date(repoState.lastScanDate);
        lastScan.setUTCDate(lastScan.getUTCDate() - 1);
        since = lastScan.toISOString();
      }
    }

    // Build the set of recent hashes for dedup (empty for a forced scan).
    const recentHashes = new Set<string>(forceScan ? [] : (repoState?.recentHashes ?? []));

    const reworkEnabled = !options?.skipRework && config.settings.rework_enabled;

    // Scan
    const result = await scanRepo(repo.path, {
      repoName,
      group: repo.group,
      authorMap,
      recentHashes,
      since,
      sinceRef,
      chunkMonths: options?.chunkMonths,
      identifierRules,
      ignorePatterns: config.settings.ignore_patterns,
      ignorePatternsReplaceDefaults: config.settings.ignore_patterns_replace_defaults,
      classificationRules: config.classification,
      collectRework: reworkEnabled,
    });

    // A failed git run: write nothing and leave the cursor where it was, so the next
    // good scan still sees everything since then (#112).
    if (result.failed) {
      console.log(`✗ ${repoName}: ${result.failed}`);
      reposFailed++;
      continue;
    }

    // ── Post-passes: rework (blame) and merged-PR proxy ───────────────────
    const shouldIgnore = buildIgnoreMatcher(config.settings.ignore_patterns, {
      replaceDefaults: config.settings.ignore_patterns_replace_defaults,
    });
    const extra: UserWeekRepoRecord[] = [];
    let prHashes: string[] = [];

    // A first scan walks ten years of history, and every counted commit that
    // deletes a line becomes a rework input — one `git diff` plus one
    // `git blame` per file, which on a large monorepo runs for tens of minutes.
    // Nothing reads rework outside window ∪ baseline (weeks_back × 2), so
    // blaming anything older buys a number no view can display.
    // The Scorecard can always reach a 12-week window + 12-week baseline
    // regardless of weeks_back, so never blame less than 24 weeks of history.
    const REWORK_MIN_WEEKS = 12;
    const analysableWeeks = new Set(
      getLastNWeeks(Math.max(config.settings.weeks_back, REWORK_MIN_WEEKS) * 2),
    );
    const reworkInputs = reworkEnabled
      ? result.reworkInputs.filter((i) => analysableWeeks.has(i.week))
      : [];

    if (reworkEnabled && reworkInputs.length > 0) {
      // Printed before the pass: a long run must look like a long run, not a hang.
      console.log(`  rework: blaming ${reworkInputs.length} commits…`);
      const rw = await runRework(reworkInputs, {
        repoPath: repo.path,
        repoName,
        group: repo.group,
        authorMap,
        identifierRules,
        windowDays: config.settings.churn_window_days,
        concurrency: config.settings.churn_concurrency,
      });
      extra.push(...rw.records);
      totalReworkCommits += rw.commitsProcessed;
      console.log(`  rework: ${rw.commitsProcessed} commits, ${rw.blames} blames`);
    }

    const pr = await runPrProxy({
      repoPath: repo.path,
      repoName,
      group: repo.group,
      authorMap,
      identifierRules,
      recentPrHashes: new Set(forceScan ? [] : (repoState?.recentPrHashes ?? [])),
      since,
      sinceRef: forceScan ? undefined : repoState?.lastPrTip,
      shouldIgnore,
    });
    if (pr.branch === null) console.log(`  PR proxy: no default branch found for ${repoName}`);
    extra.push(...pr.records);
    prHashes = pr.newPrHashes;
    totalPrs += pr.prCount;

    const merged = mergeRecordsByKey(result.newRecords, extra);

    if (options?.onRepoScanned) {
      await options.onRepoScanned(merged);
    } else {
      allNewRecords.push(...merged);
    }

    // Collect discovered authors with repo context
    const repoAuthors: RepoDiscoveredAuthor[] = result.discoveredAuthors.map((a) => ({
      ...a,
      repoName,
    }));
    allDiscoveredAuthors.push(...repoAuthors);
    if (options?.onAuthorsDiscovered && repoAuthors.length > 0) {
      await options.onAuthorsDiscovered(repoAuthors);
    }

    totalCommits += result.commitCount;
    totalRecords += merged.length;
    reposScanned++;

    // Update scan state — a forced scan replaces the cursors with the fresh
    // scan's hashes instead of rotating the old ones in, since the repo's
    // prior records and scan-state were just cleared by onRepoReset above.
    const newRecentHashes = forceScan
      ? result.newHashes.slice(0, MAX_RECENT_HASHES)
      : rotateHashes(repoState?.recentHashes ?? [], result.newHashes);
    const newRecentPrHashes = forceScan
      ? prHashes.slice(0, MAX_RECENT_HASHES)
      : rotateHashes(repoState?.recentPrHashes ?? [], prHashes);
    const existingRecordCount = forceScan ? 0 : (repoState?.recordCount ?? 0);

    currentState = updateRepoState(currentState, repoName, {
      lastHash: head ?? result.newHashes[0] ?? repoState?.lastHash ?? '',
      lastScanDate: new Date().toISOString(),
      recentHashes: newRecentHashes,
      recordCount: existingRecordCount + result.newRecords.length,
      recentPrHashes: newRecentPrHashes,
      lastTip: head ?? repoState?.lastTip,
      lastPrTip: pr.tip ?? repoState?.lastPrTip,
    });

    if (options?.onScanStateUpdated) {
      await options.onScanStateUpdated(currentState, repoName);
    }

    const ignoredNote =
      result.ignoredCommitCount > 0 ? ` (${result.ignoredCommitCount} ignored-only)` : '';
    console.log(
      `✓ ${repoName}: +${result.commitCount} commits${ignoredNote} → ${result.newRecords.length} new records`,
    );
  }

  return {
    allNewRecords,
    updatedScanState: currentState,
    discoveredAuthors: allDiscoveredAuthors,
    stats: {
      totalCommits,
      totalRecords,
      reposScanned,
      reposSkipped,
      reposMissing,
      reposFailed,
      totalPrs,
      totalReworkCommits,
    },
  };
}

/** Merge post-pass records into scan records by (member, week, repo), summing the additive counters. */
function mergeRecordsByKey(
  base: UserWeekRepoRecord[],
  extra: UserWeekRepoRecord[],
): UserWeekRepoRecord[] {
  const byKey = new Map<string, UserWeekRepoRecord>();
  for (const r of base) byKey.set(`${r.member}::${r.week}::${r.repo}`, r);
  for (const e of extra) {
    const key = `${e.member}::${e.week}::${e.repo}`;
    const r = byKey.get(key);
    if (!r) {
      byKey.set(key, e);
      continue;
    }
    r.prsMergedGit = (r.prsMergedGit ?? 0) + (e.prsMergedGit ?? 0);
    if (e.prSizes?.length) r.prSizes = [...(r.prSizes ?? []), ...e.prSizes];
    r.reworkLines = (r.reworkLines ?? 0) + (e.reworkLines ?? 0);
    r.reworkSelfLines = (r.reworkSelfLines ?? 0) + (e.reworkSelfLines ?? 0);
  }
  return [...byKey.values()];
}
