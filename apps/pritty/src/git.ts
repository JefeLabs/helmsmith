/**
 * Thin wrapper around simple-git. Exists so the rest of pritty can
 * mock git operations (and later: respect dry-run) in one place.
 *
 * v1: status, diff, stage, commit. Push, log, rebase land when
 * `pritty pr` and `pritty rebase` ship.
 */

import { spawnSync } from 'node:child_process';
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
   * Commit. Without `files`, commits everything staged. With `files`,
   * commits only the INDEX content of those paths (never the working
   * tree: `git commit -- <files>` would record what is on disk) and
   * leaves every other staged path staged. Throws when nothing in the
   * subset is staged.
   */
  commit(message: string, files?: string[]): Promise<void>;
  /** Push the current branch. setUpstream=true on first push. */
  push(branch: string, opts?: { setUpstream?: boolean }): Promise<void>;
  /** Commits reachable from `head` (default HEAD) but not from `base`: `base..head`. Newest first. */
  log(base: string, head?: string): Promise<Array<{ hash: string; subject: string }>>;
  /** Files `head` (default HEAD) changed since its merge base with `base`: `base...head`. */
  changedFilesBetween(base: string, head?: string): Promise<string[]>;
  /**
   * The ref to compare against for `base`: `origin/<base>` when the remote
   * has it (the local branch can sit stale, especially in a worktree that
   * never checks it out), otherwise `base` itself.
   */
  resolveBaseRef(base: string): Promise<string>;
  /** URL of the `origin` remote, or null if not set. */
  getRemoteUrl(): Promise<string | null>;
  /** Working tree is clean (no staged or unstaged changes, no untracked files). */
  isWorkingTreeClean(): Promise<boolean>;
  /**
   * Run an interactive rebase with a pre-written TODO. The plan is written
   * to a temp file and `GIT_SEQUENCE_EDITOR` is pointed at a `cp` command so
   * git uses it instead of opening $EDITOR; `GIT_EDITOR=true` accepts any
   * message prompt git might still open. Runs git directly: simple-git
   * refuses every editor variable, including ones inherited from the user's
   * shell. Returns ok=false on any failure, with the rebase left in place so
   * the caller can tell the user about `git rebase --continue` / `--abort`.
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
        commitIndexSubset(cwd, message, files);
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
      // Two dots on purpose: simple-git's { from, to } form emits `base...head`,
      // which for `git log` is the symmetric difference and includes base-only commits.
      const result = await git.log([`${base}..${head ?? 'HEAD'}`]);
      return result.all.map((c) => ({ hash: c.hash, subject: c.message }));
    },

    async resolveBaseRef(base: string): Promise<string> {
      const r = spawnSync('git', ['rev-parse', '--verify', '-q', `refs/remotes/origin/${base}`], {
        cwd,
        stdio: 'ignore',
      });
      return r.status === 0 ? `origin/${base}` : base;
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
      // Three dots on purpose: for `git diff` that means "since the merge base",
      // so files changed only on the base do not count as this branch's.
      const range = `${base}...${head ?? 'HEAD'}`;
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
      const dir = mkdtempSync(join(tmpdir(), 'pritty-rebase-'));
      const todoPath = join(dir, 'rebase-todo');
      writeFileSync(todoPath, todoContent, 'utf8');
      try {
        const r = spawnSync('git', ['rebase', '-i', base], {
          cwd,
          encoding: 'utf8',
          env: {
            ...process.env,
            GIT_SEQUENCE_EDITOR: `cp ${JSON.stringify(todoPath)} `,
            GIT_EDITOR: 'true',
          },
        });
        const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
        if (r.error) return { ok: false, output: r.error.message };
        return { ok: r.status === 0, output };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

function runGit(
  cwd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; input?: string } = {},
): string {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: opts.env ?? process.env,
    input: opts.input,
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim());
  }
  return r.stdout;
}

/**
 * Commit the staged content of `files` and nothing else, through a temporary
 * index so `git commit` (and therefore the repository's hooks, signing and
 * templates) still does the committing:
 *   1. seed the temporary index from HEAD (empty on an unborn branch)
 *   2. copy the real index's entries for the subset into it
 *   3. apply the subset's staged deletions
 *   4. `git commit` with GIT_INDEX_FILE pointing at it
 * The real index is untouched; after the commit its entries for the subset
 * equal HEAD, so they read as clean, and every other staged path stays staged.
 */
function commitIndexSubset(cwd: string, message: string, files: string[]): void {
  const dir = mkdtempSync(join(tmpdir(), 'pritty-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  try {
    const hasHead =
      spawnSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd, stdio: 'ignore' }).status ===
      0;
    runGit(cwd, hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], { env });
    const entries = runGit(cwd, ['ls-files', '-s', '-z', '--', ...files]);
    if (entries.length > 0)
      runGit(cwd, ['update-index', '-z', '--index-info'], { env, input: entries });
    const deleted = runGit(cwd, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
      '--diff-filter=D',
      '--',
      ...files,
    ])
      .split('\0')
      .filter(Boolean);
    if (deleted.length > 0)
      runGit(cwd, ['update-index', '--force-remove', '--', ...deleted], { env });
    const changed = hasHead
      ? runGit(cwd, ['diff-index', '--cached', '--name-only', 'HEAD'], { env }).trim()
      : runGit(cwd, ['ls-files', '-z'], { env }).trim();
    if (changed.length === 0) {
      throw new Error(`nothing staged for ${files.join(', ')}`);
    }
    runGit(cwd, ['commit', '-q', '-m', message], { env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
