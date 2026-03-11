import { loadCommitsData } from "../store/commits-by-filetype.js";
import { loadEnrichments, saveEnrichments, mergeEnrichment } from "../store/enrichments.js";
import { loadConfig } from "../config/loader.js";
import { loadAuthorRegistry } from "../store/author-registry.js";
import { buildAuthorMap, resolveAuthor, buildIdentifierRules } from "../collector/author-map.js";
import { isoWeekToDateRange, getLastNWeeks, getCurrentWeek } from "../aggregator/filters.js";
import {
  detectGitHubRemote,
  createOctokit,
  fetchGitHubMetrics,
} from "../collector/github.js";
import { calculateChurnRate } from "../collector/git.js";
import type { EnrichmentStore, ProductivityExtensions } from "../types/schema.js";

export interface EnrichOptions {
  weeks?: number;
  repo?: string;
  force?: boolean;
  skipChurn?: boolean;
  config?: string;
}

/**
 * Enrich existing commit data with GitHub process metrics and churn analysis.
 *
 * Orchestration:
 * 1. Load commits-by-filetype records and existing enrichments
 * 2. Group records by repo, then by member+week
 * 3. For each repo: detect GitHub remote, fetch metrics per member
 * 4. Save enrichments after each repo (crash-safe)
 */
export async function enrich(options: EnrichOptions): Promise<void> {
  const weeksBack = options.weeks ?? 4;

  // Load data
  const config = await loadConfig(options.config);
  const commitsData = await loadCommitsData();
  let enrichmentStore = await loadEnrichments();
  const authorRegistry = await loadAuthorRegistry();
  const authorMap = buildAuthorMap(config, authorRegistry);
  const identifierRules = buildIdentifierRules(config);

  // Determine which weeks to enrich
  const weeks = getLastNWeeks(weeksBack, getCurrentWeek());

  // Filter records to target weeks
  const targetRecords = commitsData.records.filter((r) => weeks.includes(r.week));

  if (targetRecords.length === 0) {
    console.log("No records found for the target period. Run 'gitradar scan' first.");
    return;
  }

  // Group by repo
  const repoMap = new Map<string, typeof targetRecords>();
  for (const r of targetRecords) {
    const arr = repoMap.get(r.repo) ?? [];
    arr.push(r);
    repoMap.set(r.repo, arr);
  }

  // Filter to specific repo if requested
  const repoNames = options.repo
    ? [options.repo].filter((n) => repoMap.has(n))
    : Array.from(repoMap.keys());

  if (options.repo && repoNames.length === 0) {
    console.log(`Repo "${options.repo}" not found in records.`);
    return;
  }

  // Create Octokit instance
  const octokit = await createOctokit();
  if (!octokit) {
    console.log("No GitHub token found. Set GITHUB_TOKEN or run 'gh auth login'.");
    console.log("Skipping GitHub metrics. Only churn analysis will be performed.");
  }

  let enrichedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const repoName of repoNames) {
    const repoRecords = repoMap.get(repoName)!;

    // Find repo path from config
    const repoConfig = config.repos.find(
      (r) => (r.name ?? r.path.split("/").pop() ?? r.path) === repoName,
    );
    if (!repoConfig) {
      console.log(`  ⚠ ${repoName}: not in config, skipping`);
      skippedCount++;
      continue;
    }

    // Detect GitHub remote
    let githubRemote: { owner: string; repo: string } | null = null;
    if (octokit) {
      githubRemote = await detectGitHubRemote(repoConfig.path);
      if (!githubRemote) {
        console.log(`  · ${repoName}: not a GitHub repo, skipping GitHub metrics`);
      }
    }

    // Group records by member+week
    const memberWeekMap = new Map<string, { member: string; email: string; week: string }>();
    for (const r of repoRecords) {
      const key = `${r.member}::${r.week}::${repoName}`;
      if (!memberWeekMap.has(key)) {
        memberWeekMap.set(key, { member: r.member, email: r.email, week: r.week });
      }
    }

    for (const [key, { member, email, week }] of memberWeekMap) {
      // Skip if already enriched (unless --force)
      if (!options.force && enrichmentStore.enrichments[key]) {
        skippedCount++;
        continue;
      }

      const dateRange = isoWeekToDateRange(week);
      const metrics: ProductivityExtensions = {
        prs_opened: 0,
        prs_merged: 0,
        avg_cycle_hrs: 0,
        reviews_given: 0,
        churn_rate_pct: 0,
      };

      // GitHub metrics
      if (octokit && githubRemote) {
        const resolved = resolveAuthor(authorMap, email, member, identifierRules);
        const githubHandle = resolved?.githubHandle;

        if (githubHandle) {
          const ghMetrics = await fetchGitHubMetrics({
            octokit,
            owner: githubRemote.owner,
            repo: githubRemote.repo,
            githubHandle,
            since: dateRange.since,
            until: dateRange.until,
          });
          metrics.prs_opened = ghMetrics.prs_opened;
          metrics.prs_merged = ghMetrics.prs_merged;
          metrics.avg_cycle_hrs = ghMetrics.avg_cycle_hrs;
          metrics.reviews_given = ghMetrics.reviews_given;
        }
      }

      // Churn analysis
      if (!options.skipChurn) {
        try {
          metrics.churn_rate_pct = await calculateChurnRate(
            repoConfig.path,
            email,
            dateRange.since,
            dateRange.until,
          );
        } catch {
          // Churn calculation failed — leave at 0
        }
      }

      enrichmentStore = mergeEnrichment(enrichmentStore, key, metrics);
      enrichedCount++;
    }

    // Save after each repo (crash-safe)
    await saveEnrichments(enrichmentStore);
    const repoEnriched = Array.from(memberWeekMap.keys()).length;
    console.log(
      `  ✓ ${repoName}: ${repoEnriched} member-weeks processed` +
        (githubRemote ? ` (GitHub: ${githubRemote.owner}/${githubRemote.repo})` : ""),
    );
  }

  console.log(
    `\nEnrichment complete: ${enrichedCount} enriched, ${skippedCount} skipped` +
      (errorCount > 0 ? `, ${errorCount} errors` : ""),
  );
}
