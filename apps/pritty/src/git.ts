/**
 * Thin wrapper around simple-git. Exists so the rest of pritty can
 * mock git operations (and later: respect dry-run) in one place.
 *
 * v1: status, diff, stage, commit. Push, log, rebase land when
 * `pritty pr` and `pritty rebase` ship.
 */

import { simpleGit, type SimpleGit } from "simple-git";

export interface GitOps {
  /** Files staged for commit (subset of `git status`). */
  getStaged(): Promise<string[]>;
  /** All changed files (staged + modified + untracked). */
  getAllChanged(): Promise<string[]>;
  /** Current branch name. */
  getCurrentBranch(): Promise<string>;
  /** Diff of staged changes. Optionally restrict to a file list. */
  getStagedDiff(files?: string[]): Promise<string>;
  /** Stage specific files. */
  stage(files: string[]): Promise<void>;
  /**
   * Commit. When `files` is provided, the commit is path-restricted
   * to that subset (matches `git commit -- <files>`); otherwise
   * commits everything staged.
   */
  commit(message: string, files?: string[]): Promise<void>;
  /** Push the current branch. setUpstream=true on first push. */
  push(branch: string, opts?: { setUpstream?: boolean }): Promise<void>;
  /** Commits reachable from `head` but not from `base`. Newest first. */
  log(base: string, head?: string): Promise<Array<{ hash: string; subject: string }>>;
  /** URL of the `origin` remote, or null if not set. */
  getRemoteUrl(): Promise<string | null>;
  /**
   * Most recent commits on the current branch. Used by ticket
   * inference to find ticket references in commits authored on this
   * branch within a freshness window. Returns subject + ISO date for
   * each.
   */
  recentCommitsOnBranch(
    limit: number,
  ): Promise<Array<{ hash: string; subject: string; dateISO: string }>>;
}

export function createGit(cwd: string = process.cwd()): GitOps {
  const git: SimpleGit = simpleGit(cwd);

  return {
    async getStaged(): Promise<string[]> {
      const status = await git.status();
      return [...status.staged];
    },

    async getAllChanged(): Promise<string[]> {
      const status = await git.status();
      // Dedupe in case a file is staged AND modified
      return Array.from(
        new Set([...status.staged, ...status.modified, ...status.not_added]),
      );
    },

    async getCurrentBranch(): Promise<string> {
      const branch = await git.branch();
      return branch.current;
    },

    async getStagedDiff(files?: string[]): Promise<string> {
      const args = ["--cached"];
      if (files && files.length > 0) {
        args.push("--", ...files);
      }
      return await git.diff(args);
    },

    async stage(files: string[]): Promise<void> {
      if (files.length === 0) return;
      await git.add(files);
    },

    async commit(message: string, files?: string[]): Promise<void> {
      if (files && files.length > 0) {
        await git.commit(message, files);
      } else {
        await git.commit(message);
      }
    },

    async push(branch: string, opts: { setUpstream?: boolean } = {}): Promise<void> {
      const args = ["origin", branch];
      if (opts.setUpstream) args.push("-u");
      await git.push(args);
    },

    async log(base: string, head?: string): Promise<Array<{ hash: string; subject: string }>> {
      const range = head ? `${base}..${head}` : `${base}..HEAD`;
      const result = await git.log({ from: base, to: head ?? "HEAD" }).catch(async () => {
        // Fall back to raw range syntax — some repos don't have the
        // upstream-tracking config simple-git's .log() expects.
        return await git.log([range]);
      });
      return result.all.map((c) => ({ hash: c.hash, subject: c.message }));
    },

    async getRemoteUrl(): Promise<string | null> {
      try {
        const url = await git.remote(["get-url", "origin"]);
        return typeof url === "string" ? url.trim() : null;
      } catch {
        return null;
      }
    },

    async recentCommitsOnBranch(
      limit: number,
    ): Promise<Array<{ hash: string; subject: string; dateISO: string }>> {
      try {
        const result = await git.log({ maxCount: limit });
        return result.all.map((c) => ({
          hash: c.hash,
          subject: c.message,
          dateISO: c.date,
        }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Parse owner/repo out of a GitHub remote URL. Handles both
 * https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git)
 * forms. Returns null when the URL doesn't look like GitHub.
 */
export function parseGitHubRemote(
  url: string,
): { owner: string; repo: string } | null {
  const httpsMatch = url.match(
    /https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}
