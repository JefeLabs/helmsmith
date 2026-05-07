/**
 * GitHub PR operations — thin Octokit wrapper. Token resolution:
 * the GitHub OAuth token from `~/.pritty/auth.json` (which the
 * device-flow login wrote there) is reused for the GitHub API. If
 * that's missing, fall back to GITHUB_TOKEN / GH_TOKEN env vars.
 *
 * Lives separate from src/git.ts because Octokit is a heavier
 * dependency and only the PR flow needs it; commit and rebase work
 * without it.
 */

import { Octokit } from "octokit";
import { readAuth } from "./auth.js";

export interface CreatePROptions {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface PRResult {
  number: number;
  url: string;
}

export interface OpenPRSummary {
  number: number;
  url: string;
  title: string;
  head: string;
}

/**
 * Resolve a GitHub token suitable for the REST API. Priority:
 *   1. ~/.pritty/auth.json's github-copilot apiKey (the device-flow
 *      OAuth token — works for the REST API too)
 *   2. $GITHUB_TOKEN
 *   3. $GH_TOKEN
 * Returns null when no token is available — caller should print
 * actionable next steps (`pritty auth login` or set GITHUB_TOKEN).
 */
async function resolveGitHubToken(): Promise<string | null> {
  const auth = await readAuth();
  const fromAuth = auth.providers["github-copilot"]?.apiKey;
  if (fromAuth) return fromAuth;
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
}

async function octokit(): Promise<Octokit> {
  const token = await resolveGitHubToken();
  if (!token) {
    throw new Error(
      "No GitHub token available. Run `pritty auth login` or set GITHUB_TOKEN.",
    );
  }
  return new Octokit({ auth: token });
}

/** Create a pull request. Returns its number + URL. */
export async function createPR(options: CreatePROptions): Promise<PRResult> {
  const client = await octokit();
  const result = await client.rest.pulls.create({
    owner: options.owner,
    repo: options.repo,
    head: options.head,
    base: options.base,
    title: options.title,
    body: options.body,
  });
  return {
    number: result.data.number,
    url: result.data.html_url,
  };
}

/** Apply labels to an existing PR (no-op when labels is empty). */
export async function addLabels(
  owner: string,
  repo: string,
  prNumber: number,
  labels: readonly string[],
): Promise<void> {
  if (labels.length === 0) return;
  const client = await octokit();
  await client.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [...labels],
  });
}

/**
 * List open PRs whose head matches `<owner>:<branch>`. Used to warn
 * about duplicate PR creation before the workflow proceeds. Empty
 * array if none are open.
 */
export async function listOpenPRsForHead(
  owner: string,
  repo: string,
  branch: string,
): Promise<OpenPRSummary[]> {
  const client = await octokit();
  const result = await client.rest.pulls.list({
    owner,
    repo,
    state: "open",
    head: `${owner}:${branch}`,
  });
  return result.data.map((pr) => ({
    number: pr.number,
    url: pr.html_url,
    title: pr.title,
    head: pr.head.ref,
  }));
}

/** Get the repository's default branch (used when --base isn't supplied). */
export async function getDefaultBranch(
  owner: string,
  repo: string,
): Promise<string> {
  const client = await octokit();
  const result = await client.rest.repos.get({ owner, repo });
  return result.data.default_branch;
}
