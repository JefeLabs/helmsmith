import { Octokit } from "octokit";
import { simpleGit } from "simple-git";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * GitHub process metrics for a single member in a given time period.
 */
export interface GitHubMetrics {
  prs_opened: number;
  prs_merged: number;
  avg_cycle_hrs: number;
  reviews_given: number;
}

/**
 * Parsed GitHub remote info from a git repo.
 */
export interface GitHubRemote {
  owner: string;
  repo: string;
}

/**
 * Detect GitHub owner/repo from a local git repo's origin remote.
 * Returns null if the remote is not a GitHub URL.
 */
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

/**
 * Parse a GitHub URL (HTTPS or SSH) into owner/repo.
 */
export function parseGitHubUrl(url: string): GitHubRemote | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(
    /github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(
    /github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
  );
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

/**
 * Calculate median cycle time (in hours) from a list of PRs with
 * createdAt and mergedAt timestamps.
 *
 * Uses median rather than mean to be robust against outliers
 * (e.g. a PR accidentally left open for weeks).
 * Only considers PRs that were actually merged.
 */
export function calculateCycleTime(
  prs: Array<{ createdAt: string; mergedAt: string | null }>,
): number {
  const durations = prs
    .filter((pr) => pr.mergedAt !== null)
    .map((pr) => {
      const created = new Date(pr.createdAt).getTime();
      const merged = new Date(pr.mergedAt!).getTime();
      return Math.max(0, (merged - created) / (1000 * 60 * 60)); // hours
    })
    .sort((a, b) => a - b);

  if (durations.length === 0) return 0;

  const mid = Math.floor(durations.length / 2);
  if (durations.length % 2 === 0) {
    return Math.round(((durations[mid - 1] + durations[mid]) / 2) * 10) / 10;
  }
  return Math.round(durations[mid] * 10) / 10;
}

/**
 * Create an authenticated Octokit instance.
 * Reads GITHUB_TOKEN from env, falls back to `gh auth token` CLI.
 */
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

/**
 * Fetch GitHub process metrics for a specific author in a repo during a time period.
 *
 * Queries:
 * - PRs opened by the author (search API)
 * - PRs merged by the author
 * - Reviews given by the author (pull request reviews API)
 *
 * Returns zeros on any API error (graceful degradation).
 */
export async function fetchGitHubMetrics(options: {
  octokit: Octokit;
  owner: string;
  repo: string;
  githubHandle: string;
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}): Promise<GitHubMetrics> {
  const { octokit, owner, repo, githubHandle, since, until } = options;
  const empty: GitHubMetrics = {
    prs_opened: 0,
    prs_merged: 0,
    avg_cycle_hrs: 0,
    reviews_given: 0,
  };

  try {
    // Fetch PRs opened by author in date range
    const prsOpened = await searchPRs(octokit, {
      owner,
      repo,
      author: githubHandle,
      since,
      until,
      state: "all",
    });

    // Fetch PRs merged by author in date range
    const prsMerged = await searchPRs(octokit, {
      owner,
      repo,
      author: githubHandle,
      since,
      until,
      state: "merged",
    });

    // Calculate cycle time from merged PRs
    const cycleTime = calculateCycleTime(
      prsMerged.map((pr) => ({
        createdAt: pr.created_at,
        mergedAt: pr.merged_at,
      })),
    );

    // Fetch reviews given by author
    const reviewCount = await countReviewsGiven(octokit, {
      owner,
      repo,
      reviewer: githubHandle,
      since,
      until,
    });

    return {
      prs_opened: prsOpened.length,
      prs_merged: prsMerged.length,
      avg_cycle_hrs: cycleTime,
      reviews_given: reviewCount,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`  Warning: GitHub API error for ${githubHandle}: ${msg}`);
    return empty;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface SearchPRsOptions {
  owner: string;
  repo: string;
  author: string;
  since: string;
  until: string;
  state: "all" | "merged";
}

interface PRResult {
  number: number;
  created_at: string;
  merged_at: string | null;
}

/**
 * Search for PRs by author in a date range using GitHub search API.
 */
async function searchPRs(
  octokit: Octokit,
  options: SearchPRsOptions,
): Promise<PRResult[]> {
  const { owner, repo, author, since, until, state } = options;

  let query = `repo:${owner}/${repo} is:pr author:${author} created:${since}..${until}`;
  if (state === "merged") {
    query += " is:merged";
  }

  const results: PRResult[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: perPage,
      page,
      sort: "created",
      order: "asc",
    });

    for (const item of response.data.items) {
      results.push({
        number: item.number,
        created_at: item.created_at,
        merged_at: (item.pull_request as { merged_at?: string | null } | undefined)?.merged_at ?? null,
      });
    }

    if (response.data.items.length < perPage) break;
    page++;
  }

  return results;
}

/**
 * Count reviews given by a user on PRs in a date range.
 *
 * Uses GitHub search to find PRs reviewed by this user in the date range.
 */
async function countReviewsGiven(
  octokit: Octokit,
  options: {
    owner: string;
    repo: string;
    reviewer: string;
    since: string;
    until: string;
  },
): Promise<number> {
  const { owner, repo, reviewer, since, until } = options;

  const query = `repo:${owner}/${repo} is:pr reviewed-by:${reviewer} updated:${since}..${until}`;

  let count = 0;
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      per_page: perPage,
      page,
    });

    count += response.data.items.length;

    if (response.data.items.length < perPage) break;
    page++;
  }

  return count;
}
