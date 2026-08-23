import { homedir } from 'node:os';
import path from 'node:path';
import ora from 'ora';
import { getCurrentWeek, getLastNWeeks, isoWeekToDateRange } from '../aggregator/filters.js';
import {
  buildAuthorMap,
  buildIdentifierRules,
  reattributeRecords,
  resolveAuthor,
} from '../collector/author-map.js';
import { scanDirectory } from '../collector/dir-scanner.js';
import {
  createCacheStats,
  createOctokit,
  detectGitHubRemote,
  fetchGitHubMetricsBatch,
  type GitHubMetrics,
  GitHubRateLimiter,
} from '../collector/github.js';
import { scanAllRepos } from '../collector/index.js';
import { detectGitRoot } from '../config/git-root.js';
import { loadConfig, saveConfig } from '../config/loader.js';
import type { LoadedWorkspace } from '../config/repos-registry.js';
import {
  addReposToWorkspace,
  createWorkspace,
  getAvailableWorkspaces,
  loadAllRegistries,
  removeRepoFromWorkspace,
  saveReposRegistry,
} from '../config/repos-registry.js';
import { selectWorkspace } from '../config/workspace-selector.js';
import { mergeDiscoveredAuthors } from '../store/author-registry.js';
import { DbWatcher } from '../store/db-watcher.js';
import {
  deleteRecordsForRepo,
  deleteScanStateForRepo,
  getMetaTimestamps,
  getSQLitePath,
  getStoreStatsSQLFull,
  hasEnrichment,
  loadAuthorRegistrySQL,
  loadEnrichmentsSQL,
  loadScanStateSQL,
  pruneRecordsSQL,
  queryRecords,
  queryRollup,
  reattributeRecordsSQL,
  resetAllData,
  saveAuthorRegistrySQL,
  saveEnrichmentBatchSQL,
  saveScanStateSQL,
  upsertRecords,
} from '../store/sqlite-store.js';
import type {
  AuthorRegistry,
  Config,
  Org,
  ProductivityExtensions,
  ScanState,
  UserWeekRepoRecord,
} from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';
import { readKey } from '../ui/keypress.js';
import type { ViewContext } from '../views/types.js';

export interface RunOptions {
  config?: string;
  weeks?: number;
  team?: string;
  org?: string;
  tag?: string;
  group?: string;
  demo?: boolean;
  json?: boolean;
  forceScan?: boolean;
  prune?: number;
  storeStats?: boolean;
  reset?: boolean;
  staleness?: number;
  workspace?: string;
  scanOnly?: boolean;
  initialView?: 'dashboard' | 'trends';
  skipEnrich?: boolean;
  skipRework?: boolean;
  /** Skip scan() and enrich() entirely — used by `view trends` to open the TUI
   *  straight off already-scanned data instead of triggering a fresh scan. */
  skipScan?: boolean;
}

export interface EnrichOptions {
  weeks?: number;
  repo?: string;
  force?: boolean;
  concurrency?: number;
  skipCache?: boolean;
}

/** An authenticated client — `enrich` returns early when there is no token. */
type Octokit = NonNullable<Awaited<ReturnType<typeof createOctokit>>>;

/** Per-repo enrichment tally. `skipped` = already enriched; `noData` = GitHub had nothing to say. */
interface EnrichRepoResult {
  enriched: number;
  skipped: number;
  noData: number;
  errors: number;
}

/**
 * Split the pending member-weeks into the ones GitHub returned metrics for and
 * the ones it did not.
 *
 * Only entries present in `ghResultMap` are persisted. An entry can be missing
 * because the repo has no GitHub remote, because the member has no resolvable
 * GitHub handle, or because the fetch failed — and in every one of those cases
 * writing an all-zero row would be worse than writing nothing: it reports a
 * member-week as enriched when it is not, and it is sticky, because
 * `hasEnrichment(key)` then makes every later run skip that key as "already
 * enriched" until someone passes `--force`.
 *
 * A fetch that legitimately returns all zeros (the member opened no PRs that
 * week) is real data and is persisted — presence in the map, not the values, is
 * what decides.
 */
export function selectPersistable(
  entries: readonly { key: string }[],
  ghResultMap: ReadonlyMap<string, GitHubMetrics>,
): {
  persist: Array<{ key: string; metrics: ProductivityExtensions }>;
  skipped: string[];
} {
  const persist: Array<{ key: string; metrics: ProductivityExtensions }> = [];
  const skipped: string[] = [];

  for (const { key } of entries) {
    const gh = ghResultMap.get(key);
    if (!gh) {
      skipped.push(key);
      continue;
    }
    persist.push({
      key,
      metrics: {
        prs_opened: gh.prs_opened,
        prs_merged: gh.prs_merged,
        median_cycle_hrs: gh.median_cycle_hrs,
        prs_reviewed_touched: gh.prs_reviewed_touched,
        // Retired: the blame-based rework metric supersedes it, and the store
        // no longer writes this column.
        churn_rate_pct: 0,
        pr_feature: gh.pr_feature,
        pr_fix: gh.pr_fix,
        pr_bugfix: gh.pr_bugfix,
        pr_chore: gh.pr_chore,
        pr_hotfix: gh.pr_hotfix,
        pr_other: gh.pr_other,
      },
    });
  }

  return { persist, skipped };
}

/**
 * Core engine that manages scanning, data stores, and TUI lifecycle.
 *
 * All persistent state is backed by SQLite. In-memory `records` are loaded
 * from the database on demand and cached for the current session.
 */
export class GitRadarEngine {
  config!: Config;
  /** @deprecated Use queryRecords() for targeted queries instead of bulk loading. */
  records: UserWeekRepoRecord[] = [];
  scanState?: ScanState;
  authorRegistry?: AuthorRegistry;
  private selectedWorkspace?: LoadedWorkspace;
  private resolvedConfigPath?: string;
  private dbWatcher?: DbWatcher;

  /** Clean up resources (file watchers, etc.) when the TUI exits. */
  close(): void {
    this.dbWatcher?.close();
    this.dbWatcher = undefined;
  }

  // ── Early-exit commands ──────────────────────────────────────────────────

  async handleReset(): Promise<void> {
    try {
      resetAllData();
      console.log('All data cleared. Starting fresh.');
    } catch {
      console.log('No data to clear.');
    }
  }

  async handleStoreStats(): Promise<void> {
    const stats = getStoreStatsSQLFull();
    console.log(`Store stats:`);
    console.log(`  Records:      ${stats.recordCount}`);
    console.log(`  Organizations: ${stats.orgCount}`);
    console.log(`  Teams:         ${stats.teamCount}`);
    console.log(`  Oldest week:   ${stats.oldestWeek ?? 'n/a'}`);
    console.log(`  Newest week:   ${stats.newestWeek ?? 'n/a'}`);
  }

  // ── Workspace & config resolution ────────────────────────────────────────

  /**
   * Resolve workspace, load config, and populate engine state.
   * Returns false if the user cancelled or no workspace was found.
   */
  async resolveWorkspace(opts: RunOptions): Promise<boolean> {
    let configOrgs: Config['orgs'] = [];
    let configSettings: Config['settings'] = { ...DEFAULT_SETTINGS };
    let configWorkspace: string | undefined;
    try {
      const baseConfig = await loadConfig(opts.config);
      configOrgs = baseConfig.orgs;
      configSettings = baseConfig.settings;
      configWorkspace = baseConfig.workspace;
      this.resolvedConfigPath = opts.config;
    } catch {
      // config.yml missing or invalid — proceed with defaults
    }

    const gitRoot = await detectGitRoot();
    const registries = await loadAllRegistries(gitRoot ?? undefined);
    const workspaces = getAvailableWorkspaces(registries);

    if (workspaces.length === 0) {
      const registryPath = path.join(homedir(), '.agentx', 'repos.yml');
      console.log('No workspaces found.');
      console.log(`Create one at ${registryPath}? (y/n) `);

      try {
        const answer = await readKey();
        if (answer.name !== 'y') {
          console.log('Cancelled.');
          return false;
        }
      } catch {
        return false; // Ctrl+C
      }

      const { workspace: ws } = await createWorkspace(registryPath, 'default');
      workspaces.push(ws);
      console.log(`Created workspace "default" at ${registryPath}`);
      console.log('Use D (Add repos) in the Manage tab to add repositories.\n');
    }

    const workspaceName = opts.workspace ?? configWorkspace;
    const selected = await selectWorkspace(workspaces, workspaceName);
    if (!selected) {
      console.error('No workspace selected.');
      process.exitCode = 1;
      return false;
    }

    this.selectedWorkspace = selected;

    console.log(
      `Workspace: ${selected.name} (${selected.repos.length} repos) from ${selected.source.path}`,
    );

    this.config = buildConfigFromWorkspace(selected, configOrgs, configSettings);

    if (opts.weeks !== undefined) {
      this.config = {
        ...this.config,
        settings: { ...this.config.settings, weeks_back: opts.weeks },
      };
    }

    return true;
  }

  // ── Store loading ────────────────────────────────────────────────────────

  async loadStores(): Promise<void> {
    this.scanState = loadScanStateSQL();
    this.authorRegistry = loadAuthorRegistrySQL();

    // Keep commitsData in memory for now (needed by scanAllRepos callbacks)
    const stats = getStoreStatsSQLFull();
    const lastScanAgo = getLastScanAgo(this.scanState);
    const authorCount = Object.keys(this.authorRegistry.authors).length;
    const unassignedCount = Object.values(this.authorRegistry.authors).filter((a) => !a.org).length;
    console.log(
      `Store: ${stats.recordCount} records \u00b7 ` +
        `${stats.orgCount} orgs \u00b7 ` +
        `${stats.teamCount} teams \u00b7 ` +
        `${authorCount} authors` +
        (unassignedCount > 0 ? ` (${unassignedCount} unassigned)` : '') +
        ` \u00b7 last scan: ${lastScanAgo}`,
    );
  }

  // ── Pruning ──────────────────────────────────────────────────────────────

  async handlePrune(weeks: number): Promise<void> {
    const oldestAllowed = getLastNWeeks(weeks + 1, getCurrentWeek())[0];
    if (!oldestAllowed) return;
    const removed = pruneRecordsSQL(oldestAllowed);
    console.log(`Pruned ${removed} records older than ${weeks} weeks.`);
  }

  // ── Scanning ─────────────────────────────────────────────────────────────

  async scan(opts: RunOptions): Promise<void> {
    console.log('');

    const result = await scanAllRepos(this.config, this.scanState!, {
      forceScan: opts.forceScan,
      stalenessMinutes: opts.staleness,
      chunkMonths: 3,
      skipRework: opts.skipRework,
      authorRegistry: this.authorRegistry,
      onRepoScanned: async (repoRecords) => {
        upsertRecords(repoRecords);
      },
      onScanStateUpdated: async (state) => {
        this.scanState = state;
        saveScanStateSQL(state);
      },
      onAuthorsDiscovered: async (authors) => {
        this.authorRegistry = mergeDiscoveredAuthors(
          this.authorRegistry!,
          authors.map((a) => ({
            email: a.email,
            name: a.name,
            repoName: a.repoName,
            commitCount: a.commitCount,
            date: a.lastDate,
          })),
        );
        saveAuthorRegistrySQL(this.authorRegistry!);
      },
      onRepoReset: async (name) => {
        deleteRecordsForRepo(name);
        deleteScanStateForRepo(name);
        this.forgetRepoScanState(name);
      },
    });

    const newAuthors = Object.values(this.authorRegistry!.authors).filter((a) => !a.org).length;
    console.log(
      `\nScan complete: ${result.stats.reposScanned} scanned, ` +
        `${result.stats.reposSkipped} fresh, ` +
        `${result.stats.reposMissing} missing \u2192 ` +
        `+${result.stats.totalRecords} new records` +
        ` \u00b7 ${result.stats.totalPrs} PRs` +
        (newAuthors > 0 ? ` \u00b7 ${newAuthors} unassigned authors` : ''),
    );

    // Auto-prune old records if configured
    const autoPruneWeeks = this.config.settings.auto_prune_weeks;
    if (autoPruneWeeks > 0) {
      const cutoffWeek = getLastNWeeks(autoPruneWeeks + 1, getCurrentWeek())[0];
      const pruned = pruneRecordsSQL(cutoffWeek);
      if (pruned > 0) {
        console.log(`Auto-pruned ${pruned} records older than ${autoPruneWeeks} weeks.`);
      }
    }

    // Records are now loaded on-demand by applyFilters() or buildViewContext()
    // instead of eagerly loading all data into memory after every scan.
  }

  /**
   * Drop a repo from the in-memory scan state, mirroring the `scan_state` row
   * `onRepoReset` just deleted.
   *
   * Without this, a rescan that throws after the reset leaves the repo's stale
   * entry in `this.scanState`: the next repo's `onScanStateUpdated` persists the
   * *whole* state, writing the deleted cursor back. The repo then looks freshly
   * scanned with no records, and an ordinary scan skips it as fresh or resumes
   * from the stale cursor.
   */
  private forgetRepoScanState(repoName: string): void {
    if (!this.scanState?.repos[repoName]) return;
    const { [repoName]: _removed, ...rest } = this.scanState.repos;
    this.scanState = { ...this.scanState, repos: rest };
  }

  // ── Rescan a single repo (used by ViewContext.onScanRepo) ────────────────

  async rescanRepo(
    repoName: string,
  ): Promise<{ records: UserWeekRepoRecord[]; scanState: ScanState }> {
    const repoEntry = this.config.repos.find(
      (r) => (r.name ?? r.path.split('/').pop() ?? r.path) === repoName,
    );
    if (!repoEntry) throw new Error(`Repo not found: ${repoName}`);

    const singleConfig = { ...this.config, repos: [repoEntry] };
    const currentRegistry = this.authorRegistry ?? { version: 1 as const, authors: {} };

    const freshScanState: ScanState = {
      version: 1,
      repos: { ...(this.scanState ?? { version: 1 as const, repos: {} }).repos },
    };
    delete freshScanState.repos[repoName];

    const scanResult = await scanAllRepos(singleConfig, freshScanState, {
      forceScan: true,
      chunkMonths: 3,
      authorRegistry: currentRegistry,
      onRepoScanned: async (repoRecords) => {
        upsertRecords(repoRecords);
      },
      onScanStateUpdated: async (state) => {
        saveScanStateSQL(state);
      },
      onAuthorsDiscovered: async (authors) => {
        this.authorRegistry = mergeDiscoveredAuthors(
          this.authorRegistry ?? { version: 1 as const, authors: {} },
          authors.map((a) => ({
            email: a.email,
            name: a.name,
            repoName: a.repoName,
            commitCount: a.commitCount,
            date: a.lastDate,
          })),
        );
        saveAuthorRegistrySQL(this.authorRegistry);
      },
      onRepoReset: async (name) => {
        deleteRecordsForRepo(name);
        deleteScanStateForRepo(name);
        this.forgetRepoScanState(name);
      },
    });

    const freshRecords = queryRecords({});
    this.scanState = scanResult.updatedScanState;
    return { records: freshRecords, scanState: this.scanState };
  }

  // ── Directory scanning (used by ViewContext.onScanDir) ───────────────────

  async scanDir(dirPath: string, group: string, depth: number): Promise<number> {
    if (!this.selectedWorkspace) return 0;

    const discovered = await scanDirectory(dirPath, depth);
    if (discovered.length === 0) return 0;

    const added = addReposToWorkspace(
      this.selectedWorkspace,
      discovered.map((r) => ({ name: r.name, path: r.path, group })),
    );

    if (added > 0) {
      await saveReposRegistry(
        this.selectedWorkspace.source.path,
        this.selectedWorkspace.source.registry,
      );
      this.config = buildConfigFromWorkspace(
        this.selectedWorkspace,
        this.config.orgs,
        this.config.settings,
      );
    }

    return added;
  }

  // ── Repo removal (used by ViewContext.onRemoveRepo) ──────────────────────

  async removeRepo(repoName: string): Promise<void> {
    if (!this.selectedWorkspace) return;
    removeRepoFromWorkspace(this.selectedWorkspace, repoName);
    await saveReposRegistry(
      this.selectedWorkspace.source.path,
      this.selectedWorkspace.source.registry,
    );
  }

  // ── Enrichment ──────────────────────────────────────────────────────────

  /**
   * Enrich scanned records with GitHub PR metrics (PRs opened/merged, median
   * cycle time, PRs reviewed). Uses engine state (config, records,
   * authorRegistry) so callers don't need to reload data.
   *
   * Can be called standalone (via the `enrich` CLI command) or automatically
   * after scanning. Skips already-enriched entries unless `force` is set.
   */
  async enrich(options: EnrichOptions = {}): Promise<void> {
    const weeksBack = options.weeks ?? 4;
    const _concurrency = options.concurrency ?? 5;

    const authorRegistry = this.authorRegistry ?? loadAuthorRegistrySQL();
    const authorMap = buildAuthorMap(this.config, authorRegistry);
    const identifierRules = buildIdentifierRules(this.config);

    const weeks = getLastNWeeks(weeksBack, getCurrentWeek());
    // Query only the target-period records instead of loading the entire database
    const targetRecords = queryRecords({
      weekFrom: weeks[0],
      weekTo: weeks[weeks.length - 1],
    });

    if (targetRecords.length === 0) {
      console.log('No records found for the target period.');
      return;
    }

    // Group by repo
    const repoMap = new Map<string, typeof targetRecords>();
    for (const r of targetRecords) {
      const arr = repoMap.get(r.repo) ?? [];
      arr.push(r);
      repoMap.set(r.repo, arr);
    }

    const repoNames = options.repo
      ? [options.repo].filter((n) => repoMap.has(n))
      : Array.from(repoMap.keys());

    if (options.repo && repoNames.length === 0) {
      console.log(`Repo "${options.repo}" not found in records.`);
      return;
    }

    const octokit = await createOctokit();
    const rateLimiter = new GitHubRateLimiter();

    if (!octokit) {
      console.log("No GitHub token found. Set GITHUB_TOKEN or run 'gh auth login'.");
      console.log('Skipping enrichment: GitHub PR metrics are its only source.');
      return;
    }

    let enrichedCount = 0;
    let skippedCount = 0;
    let noDataCount = 0;
    let errorCount = 0;
    const cacheStats = createCacheStats();

    const repoTotal = repoNames.length;
    const enrichCtx = {
      options,
      octokit,
      rateLimiter,
      authorMap,
      identifierRules,
      cacheStats,
    };

    for (let repoIdx = 0; repoIdx < repoTotal; repoIdx++) {
      const repoName = repoNames[repoIdx];
      const repoLabel = repoTotal > 1 ? `[${repoIdx + 1}/${repoTotal}] ${repoName}` : repoName;
      const repoRecords = repoMap.get(repoName)!;
      const result = await this.enrichRepo(repoName, repoLabel, repoRecords, enrichCtx);
      enrichedCount += result.enriched;
      skippedCount += result.skipped;
      noDataCount += result.noData;
      errorCount += result.errors;
    }

    const parts = [`${enrichedCount} enriched`, `${skippedCount} skipped`];
    if (noDataCount > 0) parts.push(`${noDataCount} no GitHub data`);
    if (errorCount > 0) parts.push(`${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`);
    if (cacheStats.hits > 0 || cacheStats.misses > 0) {
      parts.push(`${cacheStats.hits} cached / ${cacheStats.misses} fetched`);
    }
    console.log(`\nEnrichment complete: ${parts.join(', ')}`);
  }

  /** Enrich a single repo: fetch GitHub metrics and persist results. */
  private async enrichRepo(
    repoName: string,
    repoLabel: string,
    repoRecords: UserWeekRepoRecord[],
    ctx: {
      options: EnrichOptions;
      octokit: Octokit;
      rateLimiter: GitHubRateLimiter;
      authorMap: ReturnType<typeof buildAuthorMap>;
      identifierRules: ReturnType<typeof buildIdentifierRules>;
      cacheStats: ReturnType<typeof createCacheStats>;
    },
  ): Promise<EnrichRepoResult> {
    const { options, octokit, rateLimiter, authorMap, identifierRules, cacheStats } = ctx;
    let enriched = 0;
    let skipped = 0;

    const spinner = ora({ text: `${repoLabel}: preparing`, indent: 2 }).start();

    const repoConfig = this.config.repos.find(
      (r) => (r.name ?? r.path.split('/').pop() ?? r.path) === repoName,
    );
    if (!repoConfig) {
      spinner.warn(`${repoLabel}: skipped (no config)`);
      return { enriched, skipped: skipped + 1, noData: 0, errors: 0 };
    }

    spinner.text = `${repoLabel}: detecting GitHub remote`;
    const githubRemote = await detectGitHubRemote(repoConfig.path);

    // Group records by member+week (deduplicated)
    const memberWeekEntries: Array<{ key: string; member: string; email: string; week: string }> =
      [];
    const seen = new Set<string>();
    for (const r of repoRecords) {
      const key = `${r.member}::${r.week}::${repoName}`;
      if (!seen.has(key)) {
        seen.add(key);
        memberWeekEntries.push({ key, member: r.member, email: r.email, week: r.week });
      }
    }

    const toEnrich = options.force
      ? memberWeekEntries
      : memberWeekEntries.filter((e) => !hasEnrichment(e.key));
    skipped += memberWeekEntries.length - toEnrich.length;

    if (toEnrich.length === 0) {
      spinner.succeed(
        `${repoLabel}: all ${memberWeekEntries.length} member-weeks already enriched`,
      );
      return { enriched, skipped, noData: 0, errors: 0 };
    }

    // Fetch GitHub metrics batched by week
    const { results, failedKeys } = await this.fetchGitHubForRepo(
      repoLabel,
      toEnrich,
      octokit,
      githubRemote,
      rateLimiter,
      authorMap,
      identifierRules,
      options,
      cacheStats,
      spinner,
    );

    // Only member-weeks GitHub actually answered for get stored — see
    // `selectPersistable` for why an all-zero placeholder row is not an option.
    const { persist, skipped: unfetched } = selectPersistable(toEnrich, results);
    const errors = unfetched.filter((key) => failedKeys.has(key)).length;
    const noData = unfetched.length - errors;

    enriched += this.mergeAndPersistEnrichments(repoLabel, persist, spinner);

    const ghLabel = githubRemote ? ` (GitHub: ${githubRemote.owner}/${githubRemote.repo})` : '';
    if (persist.length === 0) {
      spinner.warn(
        `${repoLabel}: no GitHub data for ${unfetched.length} member-weeks — nothing stored`,
      );
    } else {
      const tail = unfetched.length > 0 ? `, ${unfetched.length} without GitHub data` : '';
      spinner.succeed(`${repoLabel}: ${persist.length} member-weeks enriched${ghLabel}${tail}`);
    }
    return { enriched, skipped, noData, errors };
  }

  /**
   * Fetch GitHub PR metrics for all entries in a repo, batched by week.
   *
   * Returns the metrics keyed by member-week, plus the keys whose fetch threw —
   * the caller reports those as errors rather than storing them as zeros.
   */
  private async fetchGitHubForRepo(
    repoLabel: string,
    toEnrich: Array<{ key: string; member: string; email: string; week: string }>,
    octokit: Octokit,
    githubRemote: { owner: string; repo: string } | null,
    rateLimiter: GitHubRateLimiter,
    authorMap: ReturnType<typeof buildAuthorMap>,
    identifierRules: ReturnType<typeof buildIdentifierRules>,
    options: EnrichOptions,
    cacheStats: ReturnType<typeof createCacheStats>,
    spinner: ReturnType<typeof ora>,
  ): Promise<{ results: Map<string, GitHubMetrics>; failedKeys: Set<string> }> {
    const ghResultMap = new Map<string, GitHubMetrics>();
    const failedKeys = new Set<string>();
    if (!githubRemote) return { results: ghResultMap, failedKeys };

    // Group entries by week
    const byWeek = new Map<string, typeof toEnrich>();
    for (const entry of toEnrich) {
      const arr = byWeek.get(entry.week) ?? [];
      arr.push(entry);
      byWeek.set(entry.week, arr);
    }

    // Resolve GitHub handles up front
    const handleMap = new Map<string, string | undefined>();
    for (const entry of toEnrich) {
      if (!handleMap.has(entry.email)) {
        const resolved = resolveAuthor(authorMap, entry.email, entry.member, identifierRules);
        handleMap.set(entry.email, resolved?.githubHandle);
      }
    }

    const weekKeys = Array.from(byWeek.keys());
    const weekTotal = weekKeys.length;
    let weekIdx = 0;

    for (const [week, entries] of byWeek) {
      weekIdx++;
      spinner.text = `${repoLabel}: GitHub PRs (week ${weekIdx}/${weekTotal})`;

      const dateRange = isoWeekToDateRange(week);

      const batchEntries: Array<{
        githubHandle: string;
        since: string;
        until: string;
        keys: string[];
      }> = [];
      for (const entry of entries) {
        const handle = handleMap.get(entry.email);
        if (handle) {
          const existing = batchEntries.find((b) => b.githubHandle === handle);
          if (existing) {
            existing.keys.push(entry.key);
          } else {
            batchEntries.push({
              githubHandle: handle,
              since: dateRange.since,
              until: dateRange.until,
              keys: [entry.key],
            });
          }
        }
      }

      if (batchEntries.length === 0) continue;

      try {
        const batchResults = await fetchGitHubMetricsBatch({
          octokit,
          owner: githubRemote.owner,
          repo: githubRemote.repo,
          entries: batchEntries.map((b) => ({
            githubHandle: b.githubHandle,
            since: b.since,
            until: b.until,
          })),
          rateLimiter,
          skipCache: options.skipCache,
          cacheStats,
        });

        for (const br of batchResults) {
          const entry = batchEntries.find((b) => b.githubHandle === br.handle);
          if (entry) {
            for (const key of entry.keys) {
              ghResultMap.set(key, br.metrics);
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const b of batchEntries) {
          for (const key of b.keys) failedKeys.add(key);
        }
        spinner.warn(`${repoLabel}: GitHub batch failed for ${week}: ${msg}`);
        spinner.start(`${repoLabel}: continuing`);
      }
    }

    return { results: ghResultMap, failedKeys };
  }

  /**
   * Persist already-selected enrichment rows in batches.
   * Returns the number of member-weeks written.
   */
  private mergeAndPersistEnrichments(
    repoLabel: string,
    persist: Array<{ key: string; metrics: ProductivityExtensions }>,
    spinner: ReturnType<typeof ora>,
  ): number {
    const SAVE_BATCH_SIZE = 20;
    const totalBatches = Math.ceil(persist.length / SAVE_BATCH_SIZE);
    let batchIdx = 0;

    for (let batchStart = 0; batchStart < persist.length; batchStart += SAVE_BATCH_SIZE) {
      batchIdx++;
      spinner.text =
        totalBatches > 1
          ? `${repoLabel}: saving (batch ${batchIdx}/${totalBatches})`
          : `${repoLabel}: saving`;

      saveEnrichmentBatchSQL(persist.slice(batchStart, batchStart + SAVE_BATCH_SIZE));
    }

    return persist.length;
  }

  // ── Filtering ────────────────────────────────────────────────────────────

  applyFilters(opts: RunOptions): void {
    // Always use SQL filtering — push predicates to the database.
    // This replaces the old pattern of loading all records into memory.
    this.records = queryRecords({
      org: opts.org,
      team: opts.team,
      tag: opts.tag,
      group: opts.group,
    });
  }

  // ── ViewContext construction ─────────────────────────────────────────────

  async buildViewContext(): Promise<ViewContext> {
    this.records = reattributeRecords(this.records, this.config, this.authorRegistry);
    const enrichmentStore = loadEnrichmentsSQL();

    // Start watching the SQLite file for external changes (e.g. background --watch scan)
    this.dbWatcher = new DbWatcher(getSQLitePath());
    this.dbWatcher.start();

    // Snapshot meta timestamps so onRefreshData can detect external changes
    let lastMeta = getMetaTimestamps();

    const ctx: ViewContext = {
      config: this.config,
      records: this.records,
      currentWeek: getCurrentWeek(),
      scanState: this.scanState,
      authorRegistry: this.authorRegistry,
      enrichments: enrichmentStore,
      queryRollup,
      onRefreshData: () => {
        const now = getMetaTimestamps();
        const changed =
          now.commitsUpdated !== lastMeta.commitsUpdated ||
          now.enrichmentsUpdated !== lastMeta.enrichmentsUpdated;
        if (!changed) return false;

        lastMeta = now;
        this.records = queryRecords({});
        ctx.records = reattributeRecords(this.records, this.config, this.authorRegistry);
        ctx.enrichments = loadEnrichmentsSQL();
        ctx.scanState = loadScanStateSQL();
        this.scanState = ctx.scanState;
        return true;
      },
      createRefreshSignal: this.dbWatcher ? () => this.dbWatcher!.createSignal() : undefined,
      onScanRepo: async (repoName: string) => {
        const result = await this.rescanRepo(repoName);
        ctx.records = result.records;
        ctx.scanState = result.scanState;
        return result;
      },
      onScanDir: this.selectedWorkspace
        ? async (dirPath: string, group: string, depth: number) => {
            const added = await this.scanDir(dirPath, group, depth);
            if (added > 0) ctx.config = this.config;
            return added;
          }
        : undefined,
      onRemoveRepo: this.selectedWorkspace
        ? (repoName: string) => this.removeRepo(repoName)
        : undefined,
      onAddOrg: async (_org: Org) => {
        await saveConfig(this.resolvedConfigPath, { orgs: ctx.config.orgs });
      },
      onSaveAuthorRegistry: async (registry) => {
        saveAuthorRegistrySQL(registry);
      },
      onReattributeRecords: async (updates) => reattributeRecordsSQL(updates),
    };

    return ctx;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function getLastScanAgo(scanState: {
  repos: Record<string, { lastScanDate: string }>;
}): string {
  let latest = 0;
  for (const r of Object.values(scanState.repos)) {
    const t = new Date(r.lastScanDate).getTime();
    if (t > latest) latest = t;
  }
  if (latest === 0) return 'never';
  const minutes = Math.round((Date.now() - latest) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function buildConfigFromWorkspace(
  ws: LoadedWorkspace,
  configOrgs: Config['orgs'],
  configSettings: Config['settings'],
): Config {
  return {
    repos: ws.repos.map((r) => ({
      path: r.path ?? '',
      name: r.name,
      group: r.group,
    })),
    orgs: configOrgs,
    groups: ws.source.registry.groups,
    tags: ws.source.registry.tags,
    settings: configSettings,
  };
}
