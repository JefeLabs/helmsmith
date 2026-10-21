import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
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
    // Neutralise the repo-config vectors that run a command when gittyup *inspects* a
    // repository it did not create (S1): `core.fsmonitor`, hooks, the pager, an external
    // diff driver and the askpass helper all execute code straight from the repo's own
    // config, and gittyup is routinely pointed at cloned repos. `-c key=val` here prefixes
    // every command simple-git runs. This is not a complete sandbox: write/network-time
    // vectors that are also legitimate (gpg.program via signing, core.sshCommand,
    // credential.helper, merge/filter drivers) are NOT blanket-overridden here because
    // doing so breaks signing, ssh remotes and private-repo auth; they are handled by
    // refusing a repo whose local config defines them (tracked separately).
    // simple-git refuses to put these config keys on the command line unless the matching
    // `allowUnsafe*` flag is set. Here the values are fixed constants that *disable* each
    // vector (never untrusted input), so enabling the flags only lets our own override
    // through; it does not relax anything for the repo's own config.
    this.git = simpleGit(repoPath, {
      config: [
        'core.fsmonitor=false',
        'core.hooksPath=/dev/null',
        'core.pager=cat',
        'diff.external=',
        'core.askpass=',
      ],
      unsafe: {
        allowUnsafeFsMonitor: true,
        allowUnsafeHooksPath: true,
        allowUnsafePager: true,
        allowUnsafeDiffExternal: true,
        allowUnsafeAskPass: true,
      },
    });
  }

  /**
   * Reject a ref that git would parse as an option (starts with `-`). Branch names and
   * aliases come from the manifest and the CLI; `git log --output=…`, `git merge
   * --upload-pack=…` and friends would otherwise write files or run commands (S5).
   */
  private assertSafeRef(ref: string): void {
    if (ref.startsWith('-')) {
      throw new Error(`refusing an option-like ref: ${JSON.stringify(ref)}`);
    }
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
    this.assertSafeRef(branchName);
    if (trackingBranch) this.assertSafeRef(trackingBranch);
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
    this.assertSafeRef(remote);
    await this.git.fetch(remote, { '--prune': null });
  }

  // ─── Merge Operations ─────────────────────────────────────────────

  async merge(
    sourceBranch: string,
    targetBranch: string,
  ): Promise<{ success: boolean; conflicts: string[] }> {
    this.assertSafeRef(sourceBranch);
    this.assertSafeRef(targetBranch);
    await this.git.checkout(targetBranch);
    try {
      await this.git.merge(['--no-ff', '--end-of-options', sourceBranch]);
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
    this.assertSafeRef(targetBranch);
    for (const sha of commits) this.assertSafeRef(sha);
    await this.git.checkout(targetBranch);
    const applied: string[] = [];

    for (const sha of commits) {
      try {
        await this.git.raw(['cherry-pick', '--end-of-options', sha]);
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
    this.assertSafeRef(branchName);
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
        // Never dereference a symlinked worktree path, or one reached through a
        // symlinked directory: a theirs/ours side that replaced the file (or a parent)
        // with a symlink would otherwise read a file from OUTSIDE the repo into
        // markedContent, which is then sent to the AI (S3). The index stage blobs below
        // are the trustworthy source.
        if (!lstatSync(fullPath).isSymbolicLink() && this.resolvesInsideRepo(fullPath)) {
          markedContent = readFileSync(fullPath, 'utf-8');
        }
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
    this.assertSafeWriteTarget(file.path);
    writeFileSync(join(this.repoPath, file.path), content, 'utf-8');
    await this.git.raw(['--literal-pathspecs', 'add', '--', file.path]);
  }

  /**
   * Refuse to write a resolution through a symlink or to a path that escapes the repo
   * (S2/G21). A theirs/ours side that turned the file into a symlink would otherwise
   * send the resolution to wherever it points — `~/.ssh/authorized_keys`, a sibling
   * repo's hooks, a file outside the repo. The index keeps the symlink; the fix is the
   * user's to make with ours/theirs, not a whole-file write.
   */
  private assertSafeWriteTarget(filePath: string): void {
    const target = join(this.repoPath, filePath);
    if (lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new ResolutionRejected(filePath, 'refusing to write through a symlink');
    }
    if (!this.resolvesInsideRepo(target)) {
      throw new ResolutionRejected(filePath, 'refusing to write outside the repository');
    }
  }

  /**
   * True when `target` (a path under the repo) stays inside the repo once every path
   * component is resolved — so neither the final component nor an intermediate directory
   * is a symlink escaping the repo. Used on both the resolution write and the conflict
   * read, so a symlinked path can neither be written through nor read from (S2/S3/G21).
   */
  private resolvesInsideRepo(target: string): boolean {
    const root = realpathSync(this.repoPath);
    try {
      // realpath the directory (the file itself may be a symlink we want to detect, or
      // may legitimately not exist yet on the write path); dirname resolution still
      // catches a symlinked intermediate directory.
      const dir = realpathSync(dirname(target));
      return dir === root || dir.startsWith(root + sep);
    } catch {
      return false;
    }
  }

  /** Keep our side. When our side deleted the file, the resolution is the deletion. */
  async resolveUseOurs(file: ConflictFile): Promise<void> {
    await this.resolveUseSide(file, file.ours, '--ours');
  }

  /** Keep their side. When their side deleted the file, the resolution is the deletion. */
  async resolveUseTheirs(file: ConflictFile): Promise<void> {
    await this.resolveUseSide(file, file.theirs, '--theirs');
  }

  /**
   * Keep one side. Whether the side was *deleted* is decided from `git ls-files -u`
   * (authoritative), not from whether `git show` printed it: a gitlink (submodule) or
   * other non-blob stage is present but unprintable, and treating it as deleted used to
   * `git rm` the submodule when the user asked to keep it (G6). A stage that is genuinely
   * absent is resolved by deletion; a present stage is checked out and staged.
   */
  private async resolveUseSide(
    file: ConflictFile,
    side: string | undefined,
    flag: '--ours' | '--theirs',
  ): Promise<void> {
    const stage = flag === '--ours' ? 2 : 3;
    const entry = await this.stageEntry(stage, file.path);
    if (!entry) {
      if (side === undefined) {
        // Genuinely deleted on this side → resolve by deletion; git removes the index
        // entries and the working-tree file, so no filesystem handling here.
        await this.git.raw(['--literal-pathspecs', 'rm', '-q', '--', file.path]);
        return;
      }
      // The loaded ConflictFile claims this side has content, but the index has no such
      // stage — refuse loudly rather than silently delete.
      throw new ResolutionRejected(
        file.path,
        `keep-${flag === '--ours' ? 'ours' : 'theirs'} but stage ${stage} is not in the index`,
      );
    }
    if (entry.mode === '160000') {
      // A gitlink (submodule): resolve it in the index directly. `git checkout <flag>`
      // would try to populate the submodule working tree and fail; treating it as a
      // deletion used to git-rm the submodule (G6). Keep the gitlink by collapsing the
      // conflicted stages to a resolved stage-0 entry at the same commit.
      await this.git.raw(['update-index', '--cacheinfo', `160000,${entry.sha},${file.path}`]);
      return;
    }
    // A normal blob present on this side: check it out and stage it.
    await this.git.raw(['--literal-pathspecs', 'checkout', flag, '--', file.path]);
    await this.git.raw(['--literal-pathspecs', 'add', '--', file.path]);
  }

  /**
   * The `git ls-files -u` entry for a stage of a path, or null when that stage is absent.
   * Lines look like `<mode> <sha> <stage>\t<path>`; this reads the index and so is
   * authoritative where `git show` is not — a gitlink stage is present but unprintable.
   */
  private async stageEntry(
    stage: 1 | 2 | 3,
    filePath: string,
  ): Promise<{ mode: string; sha: string } | null> {
    // `--literal-pathspecs` so a glob-magic filename is not treated as a pattern, `-z`
    // so the path is unquoted and NUL-delimited, and an exact path-field match so a
    // stray record can never point the caller's index write at a different file.
    const out = await this.git.raw(['--literal-pathspecs', 'ls-files', '-u', '-z', '--', filePath]);
    for (const record of out.split('\0')) {
      const m = record.match(/^(\d{6}) ([0-9a-f]+) (\d)\t(.*)$/s);
      if (m && Number(m[3]) === stage && m[4] === filePath) {
        return { mode: m[1], sha: m[2] };
      }
    }
    return null;
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
    this.assertSafeRef(branch);
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
    // An option-like name is not a branch; return false rather than let it reach git.
    if (name.startsWith('-')) return false;
    try {
      await this.git.raw(['rev-parse', '--verify', '--end-of-options', name]);
      return true;
    } catch {
      return false;
    }
  }

  async checkout(branch: string): Promise<void> {
    this.assertSafeRef(branch);
    await this.git.checkout(branch);
  }

  async push(remote = 'origin', branch?: string): Promise<void> {
    this.assertSafeRef(remote);
    const b = branch ?? (await this.getCurrentBranch());
    this.assertSafeRef(b);
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
