import { access } from "node:fs/promises";
import type { Config, UserWeekRepoRecord, ScanState } from "../types/schema.js";
import {
  isStale,
  getRepoState,
  updateRepoState,
  rotateHashes,
} from "../store/scan-state.js";
import { buildAuthorMap, buildIdentifierRules } from "./author-map.js";
import type { AuthorRegistry } from "../types/schema.js";
import { scanRepo } from "./git.js";
import type { RawAuthor } from "./git.js";

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
    /** Author registry for discovery-based resolution. */
    authorRegistry?: AuthorRegistry;
    /** Called after each repo completes. Enables per-repo persistence to bound memory. */
    onRepoScanned?: (records: UserWeekRepoRecord[]) => Promise<void>;
    /** Called after each repo's scan state is updated. Enables crash-safe resumption. */
    onScanStateUpdated?: (state: ScanState) => Promise<void>;
    /** Called after each repo with newly discovered authors. Enables per-repo author persistence. */
    onAuthorsDiscovered?: (authors: RepoDiscoveredAuthor[]) => Promise<void>;
  }
): Promise<ScanAllResult> {
  const forceScan = options?.forceScan ?? false;
  const stalenessMinutes =
    options?.stalenessMinutes ?? config.settings.staleness_minutes;

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

  for (const repo of config.repos) {
    const repoName = repo.name ?? repo.path.split("/").pop() ?? repo.path;
    const repoState = getRepoState(currentState, repoName);

    // Check staleness — skip if fresh (unless forceScan)
    if (!forceScan && !isStale(repoState, stalenessMinutes)) {
      const elapsed = repoState
        ? Math.round(
            (Date.now() - new Date(repoState.lastScanDate).getTime()) /
              60000
          )
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

    // Calculate "since" date: lastScanDate - 1 day overlap (or undefined for first scan)
    let since: string | undefined;
    if (repoState?.lastScanDate) {
      const lastScan = new Date(repoState.lastScanDate);
      lastScan.setDate(lastScan.getDate() - 1);
      since = lastScan.toISOString().slice(0, 10); // "YYYY-MM-DD"
    }

    // Build the set of recent hashes for dedup
    const recentHashes = new Set<string>(repoState?.recentHashes ?? []);

    // Scan
    const result = await scanRepo(repo.path, {
      repoName,
      group: repo.group,
      authorMap,
      recentHashes,
      since,
      chunkMonths: options?.chunkMonths,
      identifierRules,
    });

    if (options?.onRepoScanned) {
      await options.onRepoScanned(result.newRecords);
    } else {
      allNewRecords.push(...result.newRecords);
    }

    // Collect discovered authors with repo context
    const repoAuthors: RepoDiscoveredAuthor[] = result.discoveredAuthors.map(
      (a) => ({ ...a, repoName }),
    );
    allDiscoveredAuthors.push(...repoAuthors);
    if (options?.onAuthorsDiscovered && repoAuthors.length > 0) {
      await options.onAuthorsDiscovered(repoAuthors);
    }

    totalCommits += result.commitCount;
    totalRecords += result.newRecords.length;
    reposScanned++;

    // Update scan state
    const existingHashes = repoState?.recentHashes ?? [];
    const rotated = rotateHashes(existingHashes, result.newHashes);
    const existingRecordCount = repoState?.recordCount ?? 0;

    currentState = updateRepoState(currentState, repoName, {
      lastHash: result.newHashes[0] ?? repoState?.lastHash ?? "",
      lastScanDate: new Date().toISOString(),
      recentHashes: rotated,
      recordCount: existingRecordCount + result.newRecords.length,
    });

    if (options?.onScanStateUpdated) {
      await options.onScanStateUpdated(currentState);
    }

    console.log(
      `✓ ${repoName}: +${result.commitCount} commits → ${result.newRecords.length} new records`
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
    },
  };
}
