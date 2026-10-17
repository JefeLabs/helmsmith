import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { WorkkitError } from './errors.js';

export interface SyncResult {
  kind: 'up-to-date' | 'ff' | 'merge' | 'conflict';
  before: string;
  after: string;
  conflicted: string[];
}

/** The git operations the verbs need, each a thin, named wrapper over the CLI. */
export class Git {
  constructor(readonly cwd: string) {}

  tryRun(args: string[]): { code: number; out: string; err: string } {
    const r = spawnSync('git', args, { cwd: this.cwd, encoding: 'utf8' });
    return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
  }

  run(args: string[]): string {
    const r = this.tryRun(args);
    if (r.code !== 0) {
      throw new WorkkitError(
        'GIT_FAILED',
        `git ${args.join(' ')} (in ${this.cwd}): ${r.err.trim() || r.out.trim()}`,
        {
          args,
          cwd: this.cwd,
        },
      );
    }
    return r.out;
  }

  private lines(args: string[]): string[] {
    return this.run(args)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /** The checkout's top level (symlinks resolved). */
  root(): string {
    return realpathSync(this.run(['rev-parse', '--show-toplevel']).trim());
  }

  /** The main checkout's top level, from any worktree of the repo. */
  mainRoot(): string {
    const common = realpathSync(
      this.run(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(),
    );
    return dirname(common);
  }

  /** A linked worktree's git dir is always <common>/worktrees/<name>. */
  isMainCheckout(): boolean {
    return !this.run(['rev-parse', '--absolute-git-dir']).trim().includes('/worktrees/');
  }

  currentBranch(): string {
    return this.run(['branch', '--show-current']).trim();
  }

  branchExists(name: string): boolean {
    return this.tryRun(['rev-parse', '--verify', '-q', `refs/heads/${name}`]).code === 0;
  }

  remoteBranchExists(name: string): boolean {
    return this.run(['ls-remote', '--heads', 'origin', name]).trim().length > 0;
  }

  fetch(branch: string): void {
    this.run(['fetch', '-q', 'origin', branch]);
  }

  hasUpstream(): boolean {
    return this.tryRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).code === 0;
  }

  /** Commits on HEAD that origin does not have: against the upstream, else the same-named remote branch, else origin/<base>. */
  unpushedCount(base: string): number {
    let ref = `origin/${base}`;
    if (this.hasUpstream()) ref = '@{u}';
    else if (this.remoteBranchExists(this.currentBranch())) ref = `origin/${this.currentBranch()}`;
    return this.lines(['rev-list', `${ref}..HEAD`]).length;
  }

  isDirty(): boolean {
    return this.run(['status', '--porcelain']).trim().length > 0;
  }

  changedPathsStaged(): string[] {
    return this.lines(['diff', '--cached', '--name-only']);
  }

  changedPaths(from: string, to: string): string[] {
    return this.lines(['diff', '--name-only', from, to]);
  }

  commitsNotOn(base: string): string[] {
    return this.lines(['rev-list', `origin/${base}..HEAD`]);
  }

  rev(ref: string): string {
    return this.run(['rev-parse', ref]).trim();
  }

  /** Fast-forward when HEAD has no own commits, otherwise merge; never rebase. A conflict is left in place. */
  syncFrom(base: string): SyncResult {
    const target = `origin/${base}`;
    const before = this.rev('HEAD');
    const targetRev = this.rev(target);
    if (before === targetRev) return { kind: 'up-to-date', before, after: before, conflicted: [] };
    if (this.tryRun(['merge-base', '--is-ancestor', 'HEAD', target]).code === 0) {
      this.run(['merge', '--ff-only', '-q', target]);
      return { kind: 'ff', before, after: this.rev('HEAD'), conflicted: [] };
    }
    if (this.tryRun(['merge-base', '--is-ancestor', target, 'HEAD']).code === 0) {
      return { kind: 'up-to-date', before, after: before, conflicted: [] };
    }
    const merged = this.tryRun(['merge', '--no-edit', '-q', target]);
    if (merged.code === 0)
      return { kind: 'merge', before, after: this.rev('HEAD'), conflicted: [] };
    const conflicted = this.lines(['diff', '--name-only', '--diff-filter=U']);
    return { kind: 'conflict', before, after: before, conflicted };
  }

  worktreeAdd(path: string, branch: string, startPoint?: string): void {
    mkdirSync(dirname(path), { recursive: true });
    if (this.branchExists(branch)) this.run(['worktree', 'add', '-q', path, branch]);
    else this.run(['worktree', 'add', '-q', '-b', branch, path, startPoint ?? 'HEAD']);
  }

  worktreeRemove(path: string): void {
    this.run(['worktree', 'remove', '--force', path]);
  }

  checkout(branch: string, createFrom?: string): void {
    if (this.branchExists(branch)) this.run(['checkout', '-q', branch]);
    else this.run(['checkout', '-q', '-b', branch, createFrom ?? 'HEAD']);
  }

  push(branch: string): void {
    this.run(['push', '-q', '-u', 'origin', branch]);
  }

  deleteLocalBranch(branch: string): void {
    this.run(['branch', '-q', '-D', branch]);
  }
}
