import { Octokit } from "octokit";
import { simpleGit } from "simple-git";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getCacheDir } from "../store/paths.js";

const execFileAsync = promisify(execFile);

// ── Public types ────────────────────────────────────────────────────────────

export interface GitHubMetrics {
  prs_opened: number;
  prs_merged: number;
  avg_cycle_hrs: number;
  reviews_given: number;
  /** PR branch type counts — parsed from branch naming conventions. */
  pr_feature: number;
  pr_fix: number;
  pr_bugfix: number;
  pr_chore: number;
  pr_hotfix: number;
  pr_other: number;
}

export interface GitHubRemote {
  owner: string;
  repo: string;
}

// ── Remote detection (unchanged) ────────────────────────────────────────────

export async function detectGitHubRemote(
  repoPath: string,
): Promise<GitHubRemote | null> {
  const git = simpleGit(repoPath);
  let url: string;
  try {
    url = (await git.remote(["get-url", "origin"])) ?? "";
    url = url.trim();
  } catch {
    return null;
  }

  if (!url) return null;
  return parseGitHubUrl(url);
}

export function parseGitHubUrl(url: string): GitHubRemote | null {
  const httpsMatch = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = url.match(/github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

// ── Cycle time calculation (unchanged) ──────────────────────────────────────

export function calculateCycleTime(
  prs: Array<{ createdAt: string; mergedAt: string | null }>,
): number {
  const durations = prs
    .filter((pr) => pr.mergedAt !== null)
    .map((pr) => {
      const created = new Date(pr.createdAt).getTime();
      const merged = new Date(pr.mergedAt!).getTime();
      return Math.max(0, (merged - created) / (1000 * 60 * 60));
    })
    .sort((a, b) => a - b);

  if (durations.length === 0) return 0;

  const mid = Math.floor(durations.length / 2);
  if (durations.length % 2 === 0) {
    return Math.round(((durations[mid - 1] + durations[mid]) / 2) * 10) / 10;
  }
  return Math.round(durations[mid] * 10) / 10;
}

// ── Octokit creation (unchanged) ────────────────────────────────────────────

export async function createOctokit(): Promise<Octokit | null> {
  let token = process.env.GITHUB_TOKEN;

  if (!token) {
    try {
      const { stdout } = await execFileAsync("gh", ["auth", "token"]);
      token = stdout.trim();
    } catch {
      // gh CLI not available or not authenticated
    }
  }

  if (!token) return null;

  return new Octokit({ auth: token });
}

// ── Rate limiter ────────────────────────────────────────────────────────────

/**
 * A token-bucket rate limiter that respects GitHub API rate-limit headers.
 * Shared across all concurrent requests to the same Octokit instance.
 */
export class GitHubRateLimiter {
  private remaining = Infinity;
  private resetAt = 0;

  /** Call before each API request. Resolves when it's safe to proceed. */
  async acquire(): Promise<void> {
    if (this.remaining > 5) {
      this.remaining--;
      return;
    }

    const now = Date.now();
    if (this.resetAt > now) {
      const waitMs = this.resetAt - now + 500; // 500ms buffer
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // After waiting for reset, assume a fresh budget until the next update() call
      this.remaining = 100;
    }
    this.remaining--;
  }

  /** Update rate-limit state from response headers. */
  update(headers: Record<string, string | undefined>): void {
    const remaining = headers["x-ratelimit-remaining"];
    const reset = headers["x-ratelimit-reset"];

    if (remaining !== undefined) {
      this.remaining = parseInt(remaining, 10);
    }
    if (reset !== undefined) {
      this.resetAt = parseInt(reset, 10) * 1000; // convert to ms
    }
  }

  /** Update rate-limit state from GraphQL rateLimit response field. */
  updateFromGraphQL(rateLimit: { remaining: number; resetAt: string }): void {
    this.remaining = rateLimit.remaining;
    this.resetAt = new Date(rateLimit.resetAt).getTime();
  }
}

// ── GraphQL queries ─────────────────────────────────────────────────────────

const PR_SEARCH_QUERY = `
  query($prsQuery: String!, $reviewsQuery: String!, $prsCursor: String, $reviewsCursor: String) {
    prs: search(query: $prsQuery, type: ISSUE, first: 100, after: $prsCursor) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          createdAt
          mergedAt
          state
          headRefName
        }
      }
    }
    reviews: search(query: $reviewsQuery, type: ISSUE, first: 1, after: $reviewsCursor) {
      issueCount
    }
    rateLimit { remaining resetAt }
  }
`;

const PR_PAGINATE_QUERY = `
  query($prsQuery: String!, $cursor: String) {
    prs: search(query: $prsQuery, type: ISSUE, first: 100, after: $cursor) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          createdAt
          mergedAt
          state
          headRefName
        }
      }
    }
    rateLimit { remaining resetAt }
  }
`;

interface GraphQLPRNode {
  number: number;
  createdAt: string;
  mergedAt: string | null;
  state: string;
  headRefName: string;
}

interface GraphQLSearchResult {
  issueCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: GraphQLPRNode[];
}

/** Return a zeroed-out GitHubMetrics object. */
function emptyMetrics(): GitHubMetrics {
  return {
    prs_opened: 0, prs_merged: 0, avg_cycle_hrs: 0, reviews_given: 0,
    pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0,
  };
}

// ── Branch type classification ──────────────────────────────────────────────

export type BranchType = 'feature' | 'fix' | 'bugfix' | 'chore' | 'hotfix' | 'other';

/**
 * Parse a branch name's prefix to determine the PR type.
 * Matches patterns like `feature/add-auth`, `fix/login-bug`, `hotfix/critical`.
 * The prefix is the part before the first `/`.
 */
export function classifyBranch(branchName: string): BranchType {
  const prefix = branchName.split('/')[0].toLowerCase();
  switch (prefix) {
    case 'feature': return 'feature';
    case 'fix': return 'fix';
    case 'bugfix': return 'bugfix';
    case 'chore': return 'chore';
    case 'hotfix': return 'hotfix';
    default: return 'other';
  }
}

/** Count PRs by branch type from a list of PR nodes. */
export function countBranchTypes(prs: Array<{ headRefName: string }>): {
  pr_feature: number;
  pr_fix: number;
  pr_bugfix: number;
  pr_chore: number;
  pr_hotfix: number;
  pr_other: number;
} {
  const counts = { pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0 };
  for (const pr of prs) {
    const type = classifyBranch(pr.headRefName);
    counts[`pr_${type}`]++;
  }
  return counts;
}

// ── Cache layer ─────────────────────────────────────────────────────────────

/** Mutable counter for tracking cache hit/miss rates across multiple calls. */
export interface CacheStats {
  hits: number;
  misses: number;
}

export function createCacheStats(): CacheStats {
  return { hits: 0, misses: 0 };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function cacheKey(
  owner: string,
  repo: string,
  handle: string,
  since: string,
  until: string,
): string {
  return `gh_${sanitize(owner)}_${sanitize(repo)}_${sanitize(handle)}_${since}_${until}.json`;
}

async function readCache(key: string): Promise<GitHubMetrics | null> {
  try {
    const cachePath = join(getCacheDir(), key);
    const raw = await readFile(cachePath, "utf-8");
    return JSON.parse(raw) as GitHubMetrics;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: GitHubMetrics): Promise<void> {
  try {
    const dir = getCacheDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, key), JSON.stringify(data), "utf-8");
  } catch {
    // Cache write failure is non-fatal
  }
}

// ── Batch fetch (multiple authors in one GraphQL call) ──────────────────────

/** Maximum authors per batch query (2 search fields each → 20 fields total). */
const BATCH_SIZE = 10;

export interface BatchEntry {
  githubHandle: string;
  since: string;
  until: string;
}

export interface BatchResult {
  handle: string;
  metrics: GitHubMetrics;
}

/**
 * Build a dynamic GraphQL query that fetches PR + review data for multiple
 * authors in a single request using aliased search fields.
 *
 * Each author contributes 2 aliased fields: `a{i}_prs` and `a{i}_reviews`.
 * GitHub's per-query complexity budget limits us to ~10 authors per call.
 */
function buildBatchQuery(count: number): string {
  const params: string[] = [];
  const fields: string[] = [];

  for (let i = 0; i < count; i++) {
    params.push(`$prs${i}: String!`, `$reviews${i}: String!`);
    fields.push(
      `a${i}_prs: search(query: $prs${i}, type: ISSUE, first: 100) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest { number createdAt mergedAt state headRefName } }
    }`,
      `a${i}_reviews: search(query: $reviews${i}, type: ISSUE, first: 1) {
      issueCount
    }`,
    );
  }

  return `query(${params.join(', ')}) {\n    ${fields.join('\n    ')}\n    rateLimit { remaining resetAt }\n  }`;
}

/**
 * Fetch GitHub metrics for multiple authors in a single GraphQL call.
 *
 * For a repo with 50 devs over 4 weeks, this reduces API calls from ~200
 * to ~20 (batches of 10 authors). Cache is checked per-author before
 * including in the batch, and results are cached per-author after.
 *
 * If an author has >100 PRs in the date range, pagination falls back to
 * the single-author `fetchGitHubMetrics` function.
 */
export async function fetchGitHubMetricsBatch(options: {
  octokit: Octokit;
  owner: string;
  repo: string;
  entries: BatchEntry[];
  rateLimiter?: GitHubRateLimiter;
  skipCache?: boolean;
  cacheStats?: CacheStats;
}): Promise<BatchResult[]> {
  const { octokit, owner, repo, entries, rateLimiter, skipCache, cacheStats } = options;
  const results: BatchResult[] = [];

  // Check cache for each entry; only include uncached entries in the batch
  const uncached: Array<BatchEntry & { index: number }> = [];
  for (const entry of entries) {
    if (!skipCache) {
      const key = cacheKey(owner, repo, entry.githubHandle, entry.since, entry.until);
      const cached = await readCache(key);
      if (cached) {
        if (cacheStats) cacheStats.hits++;
        results.push({ handle: entry.githubHandle, metrics: cached });
        continue;
      }
    }
    if (cacheStats) cacheStats.misses++;
    uncached.push({ ...entry, index: uncached.length });
  }

  if (uncached.length === 0) return results;

  // Process uncached entries in batches
  for (let batchStart = 0; batchStart < uncached.length; batchStart += BATCH_SIZE) {
    const batch = uncached.slice(batchStart, batchStart + BATCH_SIZE);
    const query = buildBatchQuery(batch.length);

    const variables: Record<string, string> = {};
    for (let i = 0; i < batch.length; i++) {
      const { githubHandle, since, until } = batch[i];
      variables[`prs${i}`] = `repo:${owner}/${repo} is:pr author:${githubHandle} created:${since}..${until}`;
      variables[`reviews${i}`] = `repo:${owner}/${repo} is:pr reviewed-by:${githubHandle} updated:${since}..${until}`;
    }

    try {
      if (rateLimiter) await rateLimiter.acquire();

      const response = await octokit.graphql<Record<string, unknown>>(query, variables);

      if (rateLimiter && response.rateLimit) {
        rateLimiter.updateFromGraphQL(response.rateLimit as { remaining: number; resetAt: string });
      }

      for (let i = 0; i < batch.length; i++) {
        const { githubHandle, since, until } = batch[i];
        const prsData = response[`a${i}_prs`] as GraphQLSearchResult;
        const reviewsData = response[`a${i}_reviews`] as { issueCount: number };

        // If this author has >100 PRs, paginate individually
        if (prsData.pageInfo.hasNextPage) {
          try {
            const full = await fetchGitHubMetrics({
              octokit, owner, repo, githubHandle, since, until,
              rateLimiter, skipCache: true, cacheStats,
            });
            results.push({ handle: githubHandle, metrics: full });
          } catch {
            results.push({ handle: githubHandle, metrics: emptyMetrics() });
          }
          continue;
        }

        const allPRs = prsData.nodes;
        const branchCounts = countBranchTypes(allPRs);
        const metrics: GitHubMetrics = {
          prs_opened: allPRs.length,
          prs_merged: allPRs.filter((pr) => pr.state === "MERGED").length,
          avg_cycle_hrs: calculateCycleTime(
            allPRs
              .filter((pr) => pr.mergedAt !== null)
              .map((pr) => ({ createdAt: pr.createdAt, mergedAt: pr.mergedAt })),
          ),
          reviews_given: reviewsData.issueCount,
          ...branchCounts,
        };

        // Cache per-author result
        if (!skipCache) {
          const ck = cacheKey(owner, repo, githubHandle, since, until);
          await writeCache(ck, metrics);
        }

        results.push({ handle: githubHandle, metrics });
      }
    } catch (error) {
      // Batch failed — fall back to individual queries for this batch
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  Warning: batch GraphQL failed, falling back to individual queries: ${msg}`);

      for (const entry of batch) {
        try {
          const metrics = await fetchGitHubMetrics({
            octokit, owner, repo,
            githubHandle: entry.githubHandle,
            since: entry.since,
            until: entry.until,
            rateLimiter, skipCache, cacheStats,
          });
          results.push({ handle: entry.githubHandle, metrics });
        } catch {
          results.push({ handle: entry.githubHandle, metrics: emptyMetrics() });
        }
      }
    }
  }

  return results;
}

// ── Single-author fetch (GraphQL) ───────────────────────────────────────────

/**
 * Fetch GitHub process metrics for a single author using GraphQL API.
 *
 * For bulk operations, prefer `fetchGitHubMetricsBatch` which batches
 * multiple authors into a single query. This function is used for
 * pagination fallback and single-author use cases.
 */
export async function fetchGitHubMetrics(options: {
  octokit: Octokit;
  owner: string;
  repo: string;
  githubHandle: string;
  since: string;
  until: string;
  rateLimiter?: GitHubRateLimiter;
  skipCache?: boolean;
  /** Optional counter to track cache hits and misses across calls. */
  cacheStats?: CacheStats;
}): Promise<GitHubMetrics> {
  const { octokit, owner, repo, githubHandle, since, until, rateLimiter, skipCache, cacheStats } = options;
  const empty = emptyMetrics();

  // Check cache first
  if (!skipCache) {
    const key = cacheKey(owner, repo, githubHandle, since, until);
    const cached = await readCache(key);
    if (cached) {
      if (cacheStats) cacheStats.hits++;
      return cached;
    }
  }
  if (cacheStats) cacheStats.misses++;

  const prsQuery = `repo:${owner}/${repo} is:pr author:${githubHandle} created:${since}..${until}`;
  const reviewsQuery = `repo:${owner}/${repo} is:pr reviewed-by:${githubHandle} updated:${since}..${until}`;

  const result = { ...empty };

  try {
    // First query: get PRs + review count in one shot
    if (rateLimiter) await rateLimiter.acquire();

    const response = await octokit.graphql<{
      prs: GraphQLSearchResult;
      reviews: { issueCount: number };
      rateLimit: { remaining: number; resetAt: string };
    }>(PR_SEARCH_QUERY, { prsQuery, reviewsQuery, prsCursor: null, reviewsCursor: null });

    if (rateLimiter && response.rateLimit) {
      rateLimiter.updateFromGraphQL(response.rateLimit);
    }

    const allPRs: GraphQLPRNode[] = [...response.prs.nodes];
    result.reviews_given = response.reviews.issueCount;

    // Paginate remaining PRs if needed
    let pageInfo = response.prs.pageInfo;
    while (pageInfo.hasNextPage && pageInfo.endCursor) {
      if (rateLimiter) await rateLimiter.acquire();

      const nextPage = await octokit.graphql<{
        prs: GraphQLSearchResult;
        rateLimit: { remaining: number; resetAt: string };
      }>(PR_PAGINATE_QUERY, { prsQuery, cursor: pageInfo.endCursor });

      if (rateLimiter && nextPage.rateLimit) {
        rateLimiter.updateFromGraphQL(nextPage.rateLimit);
      }

      allPRs.push(...nextPage.prs.nodes);
      pageInfo = nextPage.prs.pageInfo;
    }

    result.prs_opened = allPRs.length;
    result.prs_merged = allPRs.filter((pr) => pr.state === "MERGED").length;

    result.avg_cycle_hrs = calculateCycleTime(
      allPRs
        .filter((pr) => pr.mergedAt !== null)
        .map((pr) => ({ createdAt: pr.createdAt, mergedAt: pr.mergedAt })),
    );

    const branchCounts = countBranchTypes(allPRs);
    Object.assign(result, branchCounts);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Warning: GitHub GraphQL error for ${githubHandle}: ${msg}`);
    return empty;
  }

  // Write to cache
  const key = cacheKey(owner, repo, githubHandle, since, until);
  await writeCache(key, result);

  return result;
}

