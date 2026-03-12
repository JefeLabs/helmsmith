import path from 'node:path';
import { homedir } from 'node:os';
import pLimit from 'p-limit';
import ora from 'ora';
import { loadConfig, saveConfig } from '../config/loader.js';
import { detectGitRoot } from '../config/git-root.js';
import {
  loadAllRegistries,
  getAvailableWorkspaces,
  addReposToWorkspace,
  removeRepoFromWorkspace,
  saveReposRegistry,
  createWorkspace,
} from '../config/repos-registry.js';
import type { LoadedWorkspace } from '../config/repos-registry.js';
import { scanDirectory } from '../collector/dir-scanner.js';
import { readKey } from '../ui/keypress.js';
import { selectWorkspace } from '../config/workspace-selector.js';
import {
  mergeDiscoveredAuthors,
} from '../store/author-registry.js';
import {
  upsertRecords,
  deleteRecordsForRepo,
  queryRecords,
  pruneRecordsSQL,
  getStoreStatsSQLFull,
  loadScanStateSQL,
  saveScanStateSQL,
  deleteScanStateForRepo,
  loadAuthorRegistrySQL,
  saveAuthorRegistrySQL,
  loadEnrichmentsSQL,
  saveEnrichmentBatchSQL,
  hasEnrichment,
  resetAllData,
  getMetaTimestamps,
  queryRollup,
} from '../store/sqlite-store.js';
import { DbWatcher } from '../store/db-watcher.js';
import { getSQLitePath } from '../store/sqlite-store.js';
import { scanAllRepos } from '../collector/index.js';
import { getCurrentWeek, getLastNWeeks, isoWeekToDateRange } from '../aggregator/filters.js';
import { buildAuthorMap, resolveAuthor, buildIdentifierRules, reattributeRecords } from '../collector/author-map.js';
import {
  detectGitHubRemote,
  createOctokit,
  fetchGitHubMetricsBatch,
  GitHubRateLimiter,
  createCacheStats,
  type GitHubMetrics,
} from '../collector/github.js';
import { calculateChurnRate, calculateFastChurnRate } from '../collector/git.js';
import type { ViewContext } from '../views/types.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';
import type { Config, Org, UserWeekRepoRecord, AuthorRegistry, ScanState, ProductivityExtensions } from '../types/schema.js';

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
}

export interface EnrichOptions {
  weeks?: number;
  repo?: string;
  force?: boolean;
  skipChurn?: boolean;
  deepChurn?: boolean;
  concurrency?: number;
  skipCache?: boolean;
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

  async handlePrune(pruneDays: number): Promise<void> {
    const weeksBack = Math.ceil(pruneDays / 7);
    const cutoffWeeks = getLastNWeeks(weeksBack + 200, getCurrentWeek()); // get enough weeks
    const oldestAllowed = cutoffWeeks[cutoffWeeks.length - 1];
    if (!oldestAllowed) return;
    const removed = pruneRecordsSQL(oldestAllowed);
    console.log(`Pruned ${removed} records older than ${pruneDays} days.`);
  }

  // ── Scanning ─────────────────────────────────────────────────────────────

  async scan(opts: RunOptions): Promise<void> {
    console.log('');

    const result = await scanAllRepos(this.config, this.scanState!, {
      forceScan: opts.forceScan,
      stalenessMinutes: opts.staleness,
      chunkMonths: 3,
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
    });

    const newAuthors = Object.values(this.authorRegistry!.authors).filter((a) => !a.org).length;
    console.log(
      `\nScan complete: ${result.stats.reposScanned} scanned, ` +
        `${result.stats.reposSkipped} fresh, ` +
        `${result.stats.reposMissing} missing \u2192 ` +
        `+${result.stats.totalRecords} new records` +
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

  // ── Rescan a single repo (used by ViewContext.onScanRepo) ────────────────

  async rescanRepo(repoName: string): Promise<{ records: UserWeekRepoRecord[]; scanState: ScanState }> {
    const repoEntry = this.config.repos.find(
      (r) => (r.name ?? r.path.split('/').pop() ?? r.path) === repoName,
    );
    if (!repoEntry) throw new Error(`Repo not found: ${repoName}`);

    const singleConfig = { ...this.config, repos: [repoEntry] };
    const currentRegistry = this.authorRegistry ?? { version: 1 as const, authors: {} };

    // Delete old data for this repo, then rescan
    deleteRecordsForRepo(repoName);
    deleteScanStateForRepo(repoName);

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
   * Enrich scanned records with GitHub metrics (PRs, reviews, cycle time) and
   * churn analysis. Uses engine state (config, records, authorRegistry) so
   * callers don't need to reload data.
   *
   * Can be called standalone (via the `enrich` CLI command) or automatically
   * after scanning. Skips already-enriched entries unless `force` is set.
   */
  async enrich(options: EnrichOptions = {}): Promise<void> {
    const weeksBack = options.weeks ?? 4;
    const concurrency = options.concurrency ?? 5;

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
      console.log("No records found for the target period.");
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
      console.log("Skipping GitHub metrics. Only churn analysis will be performed.");
    }

    const churnConcurrency = this.config.settings.churn_concurrency ?? 3;
    const churnWindowDays = this.config.settings.churn_window_days ?? 21;
    const churnMaxCommits = this.config.settings.churn_max_commits ?? 50;
    const churnLimit = pLimit(churnConcurrency);

    let enrichedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const cacheStats = createCacheStats();

    const repoTotal = repoNames.length;
    const enrichCtx = { options, octokit, rateLimiter, authorMap, identifierRules, churnWindowDays, churnMaxCommits, churnLimit, cacheStats };

    for (let repoIdx = 0; repoIdx < repoTotal; repoIdx++) {
      const repoName = repoNames[repoIdx];
      const repoLabel = repoTotal > 1 ? `[${repoIdx + 1}/${repoTotal}] ${repoName}` : repoName;
      const repoRecords = repoMap.get(repoName)!;
      const result = await this.enrichRepo(repoName, repoLabel, repoRecords, enrichCtx);
      enrichedCount += result.enriched;
      skippedCount += result.skipped;
      errorCount += result.errors;
    }

    const parts = [`${enrichedCount} enriched`, `${skippedCount} skipped`];
    if (errorCount > 0) parts.push(`${errorCount} errors`);
    if (cacheStats.hits > 0 || cacheStats.misses > 0) {
      parts.push(`${cacheStats.hits} cached / ${cacheStats.misses} fetched`);
    }
    console.log(`\nEnrichment complete: ${parts.join(", ")}`);
  }

  /** Enrich a single repo: fetch GitHub metrics + churn, persist results. */
  private async enrichRepo(
    repoName: string,
    repoLabel: string,
    repoRecords: UserWeekRepoRecord[],
    ctx: {
      options: EnrichOptions;
      octokit: Awaited<ReturnType<typeof createOctokit>>;
      rateLimiter: GitHubRateLimiter;
      authorMap: ReturnType<typeof buildAuthorMap>;
      identifierRules: ReturnType<typeof buildIdentifierRules>;
      churnWindowDays: number;
      churnMaxCommits: number;
      churnLimit: ReturnType<typeof pLimit>;
      cacheStats: ReturnType<typeof createCacheStats>;
    },
  ): Promise<{ enriched: number; skipped: number; errors: number }> {
    const { options, octokit, rateLimiter, authorMap, identifierRules, churnWindowDays, churnMaxCommits, churnLimit, cacheStats } = ctx;
    let enriched = 0;
    let skipped = 0;
    let errors = 0;

    const spinner = ora({ text: `${repoLabel}: preparing`, indent: 2 }).start();

    const repoConfig = this.config.repos.find(
      (r) => (r.name ?? r.path.split("/").pop() ?? r.path) === repoName,
    );
    if (!repoConfig) {
      spinner.warn(`${repoLabel}: skipped (no config)`);
      return { enriched, skipped: skipped + 1, errors };
    }

    let githubRemote: { owner: string; repo: string } | null = null;
    if (octokit) {
      spinner.text = `${repoLabel}: detecting GitHub remote`;
      githubRemote = await detectGitHubRemote(repoConfig.path);
    }

    // Group records by member+week (deduplicated)
    const memberWeekEntries: Array<{ key: string; member: string; email: string; week: string }> = [];
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
      spinner.succeed(`${repoLabel}: all ${memberWeekEntries.length} member-weeks already enriched`);
      return { enriched, skipped, errors };
    }

    // Fetch GitHub metrics batched by week
    const ghResultMap = await this.fetchGitHubForRepo(
      repoLabel, toEnrich, octokit, githubRemote, rateLimiter, authorMap, identifierRules, options, cacheStats, spinner,
    );

    // Merge GitHub results + churn into final metrics and persist
    const mergeResult = await this.mergeAndPersistEnrichments(
      repoLabel, repoConfig.path, toEnrich, ghResultMap, options, churnLimit, churnWindowDays, churnMaxCommits, spinner,
    );
    enriched += mergeResult.enriched;
    errors += mergeResult.errors;

    const ghLabel = githubRemote ? ` (GitHub: ${githubRemote.owner}/${githubRemote.repo})` : "";
    spinner.succeed(`${repoLabel}: ${toEnrich.length} member-weeks enriched${ghLabel}`);
    return { enriched, skipped, errors };
  }

  /** Fetch GitHub PR metrics for all entries in a repo, batched by week. */
  private async fetchGitHubForRepo(
    repoLabel: string,
    toEnrich: Array<{ key: string; member: string; email: string; week: string }>,
    octokit: Awaited<ReturnType<typeof createOctokit>>,
    githubRemote: { owner: string; repo: string } | null,
    rateLimiter: GitHubRateLimiter,
    authorMap: ReturnType<typeof buildAuthorMap>,
    identifierRules: ReturnType<typeof buildIdentifierRules>,
    options: EnrichOptions,
    cacheStats: ReturnType<typeof createCacheStats>,
    spinner: ReturnType<typeof ora>,
  ): Promise<Map<string, GitHubMetrics>> {
    const ghResultMap = new Map<string, GitHubMetrics>();
    if (!octokit || !githubRemote) return ghResultMap;

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

      const batchEntries: Array<{ githubHandle: string; since: string; until: string; keys: string[] }> = [];
      for (const entry of entries) {
        const handle = handleMap.get(entry.email);
        if (handle) {
          const existing = batchEntries.find((b) => b.githubHandle === handle);
          if (existing) {
            existing.keys.push(entry.key);
          } else {
            batchEntries.push({ githubHandle: handle, since: dateRange.since, until: dateRange.until, keys: [entry.key] });
          }
        }
      }

      if (batchEntries.length === 0) continue;

      try {
        const batchResults = await fetchGitHubMetricsBatch({
          octokit,
          owner: githubRemote.owner,
          repo: githubRemote.repo,
          entries: batchEntries.map((b) => ({ githubHandle: b.githubHandle, since: b.since, until: b.until })),
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
        spinner.warn(`${repoLabel}: GitHub batch failed for ${week}: ${msg}`);
        spinner.start(`${repoLabel}: continuing`);
      }
    }

    return ghResultMap;
  }

  /** Merge GitHub results with churn analysis and persist in batches. */
  private async mergeAndPersistEnrichments(
    repoLabel: string,
    repoPath: string,
    toEnrich: Array<{ key: string; member: string; email: string; week: string }>,
    ghResultMap: Map<string, GitHubMetrics>,
    options: EnrichOptions,
    churnLimit: ReturnType<typeof pLimit>,
    churnWindowDays: number,
    churnMaxCommits: number,
    spinner: ReturnType<typeof ora>,
  ): Promise<{ enriched: number; errors: number }> {
    let enriched = 0;
    let errors = 0;
    const SAVE_BATCH_SIZE = 20;
    const totalBatches = Math.ceil(toEnrich.length / SAVE_BATCH_SIZE);
    let batchIdx = 0;

    for (let batchStart = 0; batchStart < toEnrich.length; batchStart += SAVE_BATCH_SIZE) {
      batchIdx++;
      const phase = options.skipChurn ? 'saving' : 'churn analysis';
      spinner.text = totalBatches > 1
        ? `${repoLabel}: ${phase} (batch ${batchIdx}/${totalBatches})`
        : `${repoLabel}: ${phase}`;

      const batch = toEnrich.slice(batchStart, batchStart + SAVE_BATCH_SIZE);

      const settled = await Promise.allSettled(
        batch.map((entry) => {
          const { key, email, week } = entry;
          const dateRange = isoWeekToDateRange(week);

          return (async () => {
            const ghMetrics = ghResultMap.get(key);
            const metrics: ProductivityExtensions = {
              prs_opened: ghMetrics?.prs_opened ?? 0,
              prs_merged: ghMetrics?.prs_merged ?? 0,
              avg_cycle_hrs: ghMetrics?.avg_cycle_hrs ?? 0,
              reviews_given: ghMetrics?.reviews_given ?? 0,
              churn_rate_pct: 0,
              pr_feature: ghMetrics?.pr_feature ?? 0,
              pr_fix: ghMetrics?.pr_fix ?? 0,
              pr_bugfix: ghMetrics?.pr_bugfix ?? 0,
              pr_chore: ghMetrics?.pr_chore ?? 0,
              pr_hotfix: ghMetrics?.pr_hotfix ?? 0,
              pr_other: ghMetrics?.pr_other ?? 0,
            };

            if (!options.skipChurn) {
              try {
                metrics.churn_rate_pct = await churnLimit(() =>
                  options.deepChurn
                    ? calculateChurnRate(repoPath, email, dateRange.since, dateRange.until, churnWindowDays, churnMaxCommits)
                    : calculateFastChurnRate(repoPath, email, dateRange.since, dateRange.until, churnWindowDays),
                );
              } catch {
                errors++;
              }
            }

            return { key, metrics };
          })();
        }),
      );

      const fulfilled: Array<{ key: string; metrics: ProductivityExtensions }> = [];
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          fulfilled.push(s.value);
          enriched++;
        } else {
          errors++;
        }
      }
      if (fulfilled.length > 0) {
        saveEnrichmentBatchSQL(fulfilled);
      }
    }

    return { enriched, errors };
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
      createRefreshSignal: this.dbWatcher
        ? () => this.dbWatcher!.createSignal()
        : undefined,
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
