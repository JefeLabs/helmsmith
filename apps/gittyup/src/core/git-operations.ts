import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import simpleGit, { type SimpleGit, type StatusResult } from 'simple-git';
import { APP_NAME } from '../config/branding.js';
import type { ConflictFile, ConflictHunk, RepoBranchState, RepoState } from '../config/schema.js';
import { checkResolution, ResolutionRejected } from './resolution-gate.js';

/**
 * Low-level git operations for a single repository.
 * Wraps simple-git with methods for merge, cherry-pick, conflict detection, and resolution.
 */
export class GitOperations {
  private git: SimpleGit;
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.git = simpleGit(repoPath);
  }

  // ─── State Inspection ──────────────────────────────────────────────

  async getStatus(): Promise<StatusResult> {
    return this.git.status();
  }

  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current ?? 'HEAD';
  }

  /** Get detailed state for a single branch (ahead/behind, dirty, last commit). */
  async getBranchState(branchName: string, trackingBranch?: string): Promise<RepoBranchState> {
    try {
      const log = await this.git.log({ maxCount: 1, from: branchName });
      const latest = log.latest;
      const tracking = trackingBranch ?? `origin/${branchName}`;

      let ahead = 0;
      let behind = 0;
      try {
        const revList = await this.git.raw([
          'rev-list',
          '--left-right',
          '--count',
          `${branchName}...${tracking}`,
        ]);
        const [a, b] = revList.trim().split(/\s+/).map(Number);
        ahead = a ?? 0;
        behind = b ?? 0;
      } catch {
        // tracking branch may not exist
      }

      const status = await this.git.status();
      const isDirty =
        status.current === branchName &&
        (status.modified.length > 0 || status.not_added.length > 0 || status.staged.length > 0);

      return {
        branch: branchName,
        ahead,
        behind,
        hasConflicts: status.conflicted.length > 0,
        isDirty,
        lastCommit: latest?.hash?.substring(0, 8) ?? 'unknown',
        lastCommitDate: latest?.date ?? 'unknown',
        trackingBranch: tracking,
      };
    } catch {
      return {
        branch: branchName,
        ahead: 0,
        behind: 0,
        hasConflicts: false,
        isDirty: false,
        lastCommit: 'error',
        lastCommitDate: 'error',
      };
    }
  }

  /** Aggregate state across all aliased branches for dashboard display. */
  async getRepoState(
    name: string,
    group: string,
    branchAliases: Record<string, string>,
  ): Promise<RepoState> {
    try {
      const currentBranch = await this.getCurrentBranch();
      const branches: Record<string, RepoBranchState> = {};

      for (const [alias, branchName] of Object.entries(branchAliases)) {
        try {
          branches[alias] = await this.getBranchState(branchName);
        } catch {
          /* branch may not exist locally */
        }
      }

      const status = await this.git.status();
      return {
        name,
        group,
        path: this.repoPath,
        currentBranch,
        branches,
        hasUnresolved: status.conflicted.length > 0,
      };
    } catch (err) {
      return {
        name,
        group,
        path: this.repoPath,
        currentBranch: 'unknown',
        branches: {},
        hasUnresolved: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Fetch ─────────────────────────────────────────────────────────

  async fetch(remote = 'origin'): Promise<void> {
    await this.git.fetch(remote, { '--prune': null });
  }

  // ─── Merge Operations ─────────────────────────────────────────────

  async merge(
    sourceBranch: string,
    targetBranch: string,
  ): Promise<{ success: boolean; conflicts: string[] }> {
    await this.git.checkout(targetBranch);
    try {
      await this.git.merge([sourceBranch, '--no-ff']);
      return { success: true, conflicts: [] };
    } catch {
      const status = await this.git.status();
      if (status.conflicted.length > 0) {
        return { success: false, conflicts: status.conflicted };
      }
      throw new Error(`Merge failed: ${sourceBranch} → ${targetBranch}`);
    }
  }

  // ─── Cherry-Pick Operations ───────────────────────────────────────

  async cherryPick(
    commits: string[],
    targetBranch: string,
  ): Promise<{ success: boolean; applied: string[]; failedAt?: string; conflicts: string[] }> {
    await this.git.checkout(targetBranch);
    const applied: string[] = [];

    for (const sha of commits) {
      try {
        await this.git.raw(['cherry-pick', sha]);
        applied.push(sha);
      } catch {
        const status = await this.git.status();
        if (status.conflicted.length > 0) {
          return { success: false, applied, failedAt: sha, conflicts: status.conflicted };
        }
        throw new Error(`cherry-pick failed on ${sha}`);
      }
    }
    return { success: true, applied, conflicts: [] };
  }

  async cherryPickAbort(): Promise<void> {
    await this.git.raw(['cherry-pick', '--abort']);
  }

  async cherryPickContinue(): Promise<void> {
    await this.git.raw(['cherry-pick', '--continue']);
  }

  // ─── Conflict Branch Management ───────────────────────────────────

  async createConflictBranch(prefix: string, label: string): Promise<string> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const branchName = `${prefix}/${label}-${ts}`;
    await this.git.checkoutLocalBranch(branchName);
    return branchName;
  }

  // ─── Conflict Inspection ──────────────────────────────────────────

  /**
   * Every conflicted path with the complete file from each index stage
   * (:1 base, :2 ours, :3 theirs) plus the marked working copy. A stage
   * that does not exist (the side deleted the file) is `undefined`.
   */
  async getConflictedFiles(): Promise<ConflictFile[]> {
    const status = await this.git.status();
    const files: ConflictFile[] = [];

    for (const filePath of status.conflicted) {
      const fullPath = join(this.repoPath, filePath);
      let markedContent = '';
      try {
        markedContent = readFileSync(fullPath, 'utf-8');
      } catch {
        /* absent on disk (deleted by one side) */
      }
      const [base, ours, theirs] = await Promise.all([
        this.showStage(1, filePath),
        this.showStage(2, filePath),
        this.showStage(3, filePath),
      ]);
      files.push({
        path: filePath,
        markedContent,
        ours,
        theirs,
        base,
        hunks: parseConflictHunks(markedContent),
      });
    }
    return files;
  }

  /** `git show :<stage>:<path>`, or undefined when that stage is absent. */
  private async showStage(stage: 1 | 2 | 3, filePath: string): Promise<string | undefined> {
    try {
      return await this.git.show([`:${stage}:${filePath}`]);
    } catch {
      return undefined;
    }
  }

  // ─── Resolution ───────────────────────────────────────────────────

  /**
   * The only path that writes a resolved file. Runs the gate first and
   * throws `ResolutionRejected` (file untouched, still conflicted) when
   * it refuses; otherwise writes the content and stages the path.
   */
  async applyResolution(file: ConflictFile, content: string): Promise<void> {
    const verdict = checkResolution(content, file);
    if (!verdict.ok) throw new ResolutionRejected(file.path, verdict.reason);
    writeFileSync(join(this.repoPath, file.path), content, 'utf-8');
    await this.git.raw(['--literal-pathspecs', 'add', '--', file.path]);
  }

  /** Keep our side. When our side deleted the file, the resolution is the deletion. */
  async resolveUseOurs(filePath: string): Promise<void> {
    await this.resolveUseSide(2, '--ours', filePath);
  }

  /** Keep their side. When their side deleted the file, the resolution is the deletion. */
  async resolveUseTheirs(filePath: string): Promise<void> {
    await this.resolveUseSide(3, '--theirs', filePath);
  }

  private async resolveUseSide(
    stage: 2 | 3,
    flag: '--ours' | '--theirs',
    filePath: string,
  ): Promise<void> {
    if ((await this.showStage(stage, filePath)) === undefined) {
      // Resolve by deletion; git removes both the index entries and the
      // working-tree file, so no filesystem handling here.
      await this.git.raw(['--literal-pathspecs', 'rm', '-q', '--', filePath]);
      return;
    }
    await this.git.raw(['--literal-pathspecs', 'checkout', flag, '--', filePath]);
    await this.git.raw(['--literal-pathspecs', 'add', '--', filePath]);
  }

  async commitResolution(message?: string): Promise<string> {
    await this.git.commit(message ?? `Resolve conflicts via ${APP_NAME}`);
    const log = await this.git.log({ maxCount: 1 });
    return log.latest?.hash ?? 'unknown';
  }

  async abortMerge(): Promise<void> {
    await this.git.merge(['--abort']);
  }

  // ─── Commit Listing ───────────────────────────────────────────────

  async listCommits(
    branch: string,
    maxCount = 50,
  ): Promise<Array<{ hash: string; date: string; message: string; author: string }>> {
    const log = await this.git.log({ maxCount, from: branch });
    return log.all.map((c) => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author: c.author_name,
    }));
  }

  // ─── Branch Operations ────────────────────────────────────────────

  async branchExists(name: string): Promise<boolean> {
    try {
      await this.git.raw(['rev-parse', '--verify', name]);
      return true;
    } catch {
      return false;
    }
  }

  async checkout(branch: string): Promise<void> {
    await this.git.checkout(branch);
  }

  async push(remote = 'origin', branch?: string): Promise<void> {
    const b = branch ?? (await this.getCurrentBranch());
    await this.git.push(remote, b, ['--set-upstream']);
  }

  async stash(): Promise<boolean> {
    const result = await this.git.stash();
    return !result.includes('No local changes');
  }

  async stashPop(): Promise<void> {
    await this.git.stash(['pop']);
  }

  /** Expose the underlying simple-git instance for advanced operations. */
  get instance(): SimpleGit {
    return this.git;
  }
}

/**
 * Split a marked file into its conflict regions. Lines are joined with
 * `\n` regardless of the file's line endings; `base` is present only for
 * diff3-style markers. Non-conflicting lines are dropped — this is for
 * preview, never for writing.
 */
export function parseConflictHunks(marked: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  let section: 'none' | 'ours' | 'base' | 'theirs' = 'none';
  let ours: string[] = [];
  let base: string[] | undefined;
  let theirs: string[] = [];

  for (const line of marked.split(/\r?\n/)) {
    if (line.startsWith('<<<<<<<')) {
      section = 'ours';
      ours = [];
      base = undefined;
      theirs = [];
    } else if (line.startsWith('|||||||') && section === 'ours') {
      section = 'base';
      base = [];
    } else if (line.startsWith('=======') && (section === 'ours' || section === 'base')) {
      section = 'theirs';
    } else if (line.startsWith('>>>>>>>') && section === 'theirs') {
      section = 'none';
      hunks.push({
        ours: ours.join('\n'),
        theirs: theirs.join('\n'),
        ...(base !== undefined ? { base: base.join('\n') } : {}),
      });
    } else if (section === 'ours') ours.push(line);
    else if (section === 'base') base?.push(line);
    else if (section === 'theirs') theirs.push(line);
  }
  return hunks;
}
