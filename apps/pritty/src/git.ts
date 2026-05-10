/**
 * Thin wrapper around simple-git. Exists so the rest of pritty can
 * mock git operations (and later: respect dry-run) in one place.
 *
 * v1: status, diff, stage, commit. Push, log, rebase land when
 * `pritty pr` and `pritty rebase` ship.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SimpleGit, simpleGit } from 'simple-git';

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
  /** Files changed between base..head (defaults to base..HEAD). */
  changedFilesBetween(base: string, head?: string): Promise<string[]>;
  /** URL of the `origin` remote, or null if not set. */
  getRemoteUrl(): Promise<string | null>;
  /** Working tree is clean (no staged or unstaged changes, no untracked files). */
  isWorkingTreeClean(): Promise<boolean>;
  /**
   * Run an interactive rebase with a pre-written TODO. The plan
   * is written to a temp file and `GIT_SEQUENCE_EDITOR` is pointed
   * at a `cp` command so git uses it instead of opening $EDITOR.
   * Returns true on clean completion, false on any failure (so the
   * caller can prompt the user about `git rebase --abort`).
   */
  rebaseWithPlan(base: string, todoContent: string): Promise<{ ok: boolean; output: string }>;
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
      return Array.from(new Set([...status.staged, ...status.modified, ...status.not_added]));
    },

    async getCurrentBranch(): Promise<string> {
      const branch = await git.branch();
      return branch.current;
    },

    async getStagedDiff(files?: string[]): Promise<string> {
      const args = ['--cached'];
      if (files && files.length > 0) {
        args.push('--', ...files);
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
      const args = ['origin', branch];
      if (opts.setUpstream) args.push('-u');
      await git.push(args);
    },

    async log(base: string, head?: string): Promise<Array<{ hash: string; subject: string }>> {
      const range = head ? `${base}..${head}` : `${base}..HEAD`;
      const result = await git.log({ from: base, to: head ?? 'HEAD' }).catch(async () => {
        // Fall back to raw range syntax — some repos don't have the
        // upstream-tracking config simple-git's .log() expects.
        return await git.log([range]);
      });
      return result.all.map((c) => ({ hash: c.hash, subject: c.message }));
    },

    async getRemoteUrl(): Promise<string | null> {
      try {
        const url = await git.remote(['get-url', 'origin']);
        return typeof url === 'string' ? url.trim() : null;
      } catch {
        return null;
      }
    },

    async changedFilesBetween(base: string, head?: string): Promise<string[]> {
      const range = head ? `${base}..${head}` : `${base}..HEAD`;
      try {
        const result = await git.diff(['--name-only', range]);
        return result
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      } catch {
        return [];
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

    async isWorkingTreeClean(): Promise<boolean> {
      const status = await git.status();
      return status.isClean();
    },

    async rebaseWithPlan(
      base: string,
      todoContent: string,
    ): Promise<{ ok: boolean; output: string }> {
      // Write the TODO to a tmp file and point GIT_SEQUENCE_EDITOR
      // at a `cp` command. git uses this instead of opening $EDITOR
      // for the rebase TODO step. POSIX-only — Windows users would
      // need a different shim.
      const dir = mkdtempSync(join(tmpdir(), 'pritty-rebase-'));
      const todoPath = join(dir, 'rebase-todo');
      writeFileSync(todoPath, todoContent, 'utf8');
      try {
        const env = {
          ...process.env,
          GIT_SEQUENCE_EDITOR: `cp ${JSON.stringify(todoPath)} `,
        };
        const result = await git.env(env).rebase(['-i', base]);
        return { ok: true, output: typeof result === 'string' ? result : '' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, output: message };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Parse owner/repo out of a GitHub remote URL. Handles both
 * https://github.com/owner/repo(.git) and git@github.com:owner/repo(.git)
 * forms. Returns null when the URL doesn't look like GitHub.
 */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}
