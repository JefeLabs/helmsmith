/**
 * GitHub PR operations — thin Octokit wrapper. Token resolution lives in
 * github-token.ts: GH_TOKEN, GITHUB_TOKEN, `gh auth token` (for the
 * configured account first), then the Copilot device-flow token as a
 * last resort.
 *
 * Lives separate from src/git.ts because Octokit is a heavier
 * dependency and only the PR flow needs it; commit and rebase work
 * without it.
 */

import { Octokit } from 'octokit';
import { readAuth } from './auth.js';
import { loadConfig } from './config.js';
import { defaultTokenResolveOptions, resolveGitHubToken } from './github-token.js';

export interface CreatePROptions {
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface PRResult {
  number: number;
  url: string;
  draft: boolean;
}

export interface OpenPRSummary {
  number: number;
  url: string;
  title: string;
  head: string;
  base: string;
  draft: boolean;
}

export interface PRPatch {
  title?: string;
  body?: string;
}

let warned = false;

/** See github-token.ts for the order. Prints the weak-source warning once per process. */
async function resolveToken(): Promise<string | null> {
  const resolved = await resolveGitHubToken(
    defaultTokenResolveOptions(readAuth, loadConfig().github?.account),
  );
  if (!resolved) return null;
  if (resolved.warning && !warned) {
    warned = true;
    console.error(`⚠ ${resolved.warning}`);
  }
  return resolved.token;
}

async function octokit(): Promise<Octokit> {
  const token = await resolveToken();
  if (!token) {
    throw new Error(
      'No GitHub token available. Set GH_TOKEN, run `gh auth login`, or `pritty auth login`.',
    );
  }
  return new Octokit({ auth: token });
}

/** Resolve the token now, so a missing or unusable one fails before anything is pushed. */
export async function assertGitHubToken(): Promise<void> {
  await octokit();
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
    ...(options.draft ? { draft: true } : {}),
  });
  return {
    number: result.data.number,
    url: result.data.html_url,
    draft: Boolean(result.data.draft),
  };
}

/** Change an existing PR's title and/or body in place. No-op for an empty patch. */
export async function updatePR(
  owner: string,
  repo: string,
  prNumber: number,
  patch: PRPatch,
): Promise<void> {
  if (patch.title === undefined && patch.body === undefined) return;
  const client = await octokit();
  await client.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.body !== undefined ? { body: patch.body } : {}),
  });
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
 * Request reviewers on an existing PR. Splits user reviewers from
 * team reviewers per Octokit's API shape. No-op when both lists
 * are empty. GitHub silently ignores invalid reviewers (deleted
 * users, teams the bot can't see); we don't try to validate ahead.
 */
export async function requestReviewers(
  owner: string,
  repo: string,
  prNumber: number,
  users: readonly string[],
  teams: readonly string[],
): Promise<void> {
  if (users.length === 0 && teams.length === 0) return;
  const client = await octokit();
  await client.rest.pulls.requestReviewers({
    owner,
    repo,
    pull_number: prNumber,
    ...(users.length > 0 ? { reviewers: [...users] } : {}),
    ...(teams.length > 0 ? { team_reviewers: [...teams] } : {}),
  });
}

/**
 * List open PRs whose head is `<owner>:<branch>`, optionally only those
 * targeting `base`. Used before anything is generated or pushed: an existing
 * PR for the same head and base is returned instead of creating a second one.
 */
export async function listOpenPRs(
  owner: string,
  repo: string,
  branch: string,
  base?: string,
): Promise<OpenPRSummary[]> {
  const client = await octokit();
  const result = await client.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${branch}`,
    ...(base ? { base } : {}),
  });
  return result.data.map((pr) => ({
    number: pr.number,
    url: pr.html_url,
    title: pr.title,
    head: pr.head.ref,
    base: pr.base.ref,
    draft: Boolean(pr.draft),
  }));
}

/** @deprecated use listOpenPRs; kept for the programmatic API. */
export function listOpenPRsForHead(
  owner: string,
  repo: string,
  branch: string,
): Promise<OpenPRSummary[]> {
  return listOpenPRs(owner, repo, branch);
}

/** Get the repository's default branch (used when --base isn't supplied). */
export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const client = await octokit();
  const result = await client.rest.repos.get({ owner, repo });
  return result.data.default_branch;
}
