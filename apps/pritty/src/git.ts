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
  };
}
