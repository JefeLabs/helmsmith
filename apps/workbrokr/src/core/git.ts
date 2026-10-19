import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { WorkkitError } from './errors.js';

const realpathOr = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/** No control characters, whitespace or `=`: the name is spliced into a `-c submodule.<name>.url=` key. */
const SAFE_SUBMODULE_NAME = /^[^\p{Cc}\s=]+$/u;

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

  /** The main checkout is the one whose git dir IS the common dir (compared as absolute realpaths). */
  isMainCheckout(): boolean {
    const gitDir = realpathSync(
      this.run(['rev-parse', '--path-format=absolute', '--git-dir']).trim(),
    );
    const common = realpathSync(
      this.run(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(),
    );
    return gitDir === common;
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

  /** Commits on origin/<base> that HEAD does not have (0 when the ref is unknown). */
  behindCount(base: string): number {
    const r = this.tryRun(['rev-list', '--count', `HEAD..origin/${base}`]);
    return r.code === 0 ? Number(r.out.trim()) || 0 : 0;
  }

  isDirty(): boolean {
    return this.run(['status', '--porcelain']).trim().length > 0;
  }

  changedPathsStaged(): string[] {
    return this.lines(['diff', '--cached', '--name-only']);
  }

  /** The other parent of a merge in progress, or undefined when none is. */
  mergeHead(): string | undefined {
    const r = this.tryRun(['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    return r.code === 0 ? r.out.trim() : undefined;
  }

  /** Staged paths whose index content differs from `ref` (so, authored here rather than taken from `ref`). */
  stagedDifferingFrom(ref: string, paths: string[]): string[] {
    if (paths.length === 0) return [];
    return this.lines(['diff', '--cached', '--name-only', '--no-renames', ref, '--', ...paths]);
  }

  changedPaths(from: string, to: string): string[] {
    return this.lines(['diff', '--name-only', '--no-renames', from, to]);
  }

  /** Paths this branch changed since it diverged from origin/<base> (three-dot), without the base's own changes. */
  changedSince(base: string): string[] {
    return this.lines(['diff', '--name-only', '--no-renames', `origin/${base}...HEAD`]);
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

  /** `origin/<branch>` after a fetch attempt, when the remote has it; the local copy may have been retired. */
  remoteRef(branch: string): string | undefined {
    this.tryRun(['fetch', '-q', 'origin', branch]);
    const ref = `refs/remotes/origin/${branch}`;
    return this.tryRun(['rev-parse', '--verify', '-q', ref]).code === 0
      ? `origin/${branch}`
      : undefined;
  }

  /**
   * Add a worktree on `branch`: the local branch if it exists, else a tracking
   * branch from origin/<branch> if the remote has it (so retiring the local
   * branch while its PR was open never recreates it from the base), else a
   * new branch from `startPoint`.
   */
  worktreeAdd(path: string, branch: string, startPoint?: string): void {
    mkdirSync(dirname(path), { recursive: true });
    if (this.branchExists(branch)) {
      this.run(['worktree', 'add', '-q', path, branch]);
      return;
    }
    const remote = this.remoteRef(branch);
    if (remote) {
      this.run(['worktree', 'add', '-q', '--track', '-b', branch, path, remote]);
      return;
    }
    this.run(['worktree', 'add', '-q', '--no-track', '-b', branch, path, startPoint ?? 'HEAD']);
  }

  worktreeRemove(path: string): void {
    this.run(['worktree', 'remove', '--force', path]);
  }

  checkout(branch: string, createFrom?: string): void {
    if (this.branchExists(branch)) {
      this.run(['checkout', '-q', branch]);
      return;
    }
    const remote = this.remoteRef(branch);
    if (remote) {
      this.run(['checkout', '-q', '--track', '-b', branch, remote]);
      return;
    }
    this.run(['checkout', '-q', '--no-track', '-b', branch, createFrom ?? 'HEAD']);
  }

  push(branch: string): void {
    this.run(['push', '-q', '-u', 'origin', branch]);
  }

  deleteLocalBranch(branch: string): void {
    this.run(['branch', '-q', '-D', branch]);
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    return this.tryRun(['merge-base', '--is-ancestor', ancestor, descendant]).code === 0;
  }

  /** True when HEAD's tree matches origin/<base>, or every commit on HEAD is patch-equivalent to origin/<base> (squash-merged). */
  isEquivalentToBase(base: string): boolean {
    const target = `origin/${base}`;
    if (this.tryRun(['diff', '--quiet', target, 'HEAD']).code === 0) return true;
    const cherry = this.tryRun(['cherry', target, 'HEAD']);
    if (cherry.code !== 0) return false;
    const lines = cherry.out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.length > 0 && lines.every((l) => l.startsWith('- '));
  }

  /**
   * Give a linked worktree its own clone of every submodule the main checkout has initialized,
   * cloned locally from the main checkout's module directory (no network) and then re-pointed at
   * the real URL. `git worktree add` under submodule.recurse leaves a gitfile aimed at a module
   * directory that was never cloned; a gitfile aimed at the MAIN checkout's module directory is
   * worse, because that module's core.worktree is the main checkout's submodule, so any git
   * command in the worktree's submodule (checkout -f, reset, merge) rewrites the human's files.
   * Both shapes are replaced; a submodule that is already its own working tree is left alone.
   */
  repairSubmodules(mainRoot: string, log: (line: string) => void = () => {}): void {
    const gitmodules = join(this.cwd, '.gitmodules');
    if (!existsSync(gitmodules)) return;
    const cfg = this.tryRun([
      'config',
      '-f',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..*\\.path$',
    ]);
    if (cfg.code !== 0) return;
    const wtGitDir = this.run(['rev-parse', '--path-format=absolute', '--git-dir']).trim();
    for (const line of cfg.out.split('\n').filter(Boolean)) {
      const m = /^submodule\.(.+)\.path\s+(.+)$/.exec(line.trim());
      if (!m) continue;
      const [, name, subPath] = m as unknown as [string, string, string];
      // the name becomes a path segment under <git-dir>/modules and a config key: refuse anything
      // git itself would reject (CVE-2018-11235 shape) before we delete or spawn with it
      const modulesDir = resolve(wtGitDir, 'modules');
      const moduleDir = resolve(modulesDir, name);
      if (
        !SAFE_SUBMODULE_NAME.test(name) ||
        name.split(/[\\/]/).some((seg) => seg === '' || seg === '.' || seg === '..') ||
        !moduleDir.startsWith(modulesDir + sep)
      ) {
        log(`submodule ${subPath}: refusing name ${JSON.stringify(name)}; not repaired`);
        continue;
      }
      const wtSub = join(this.cwd, subPath);
      const wtGit = join(wtSub, '.git');
      if (this.isOwnSubmodule(wtSub, wtGit)) continue;
      const mainSub = join(mainRoot, subPath);
      if (!existsSync(join(mainSub, '.git'))) continue; // never initialized there: nothing to clone from
      const src = new Git(mainSub).tryRun(['rev-parse', '--path-format=absolute', '--git-dir']);
      if (src.code !== 0 || !src.out.trim()) continue;
      // a stale or borrowed gitfile and a half-made module dir both make `submodule update` refuse
      if (existsSync(wtGit) && statSync(wtGit).isFile()) rmSync(wtGit);
      rmSync(moduleDir, { recursive: true, force: true });
      const r = this.tryRun([
        '-c',
        'protocol.file.allow=always',
        '-c',
        `submodule.${name}.url=${src.out.trim()}`,
        'submodule',
        'update',
        '--init',
        '--',
        subPath,
      ]);
      if (r.code !== 0) {
        log(
          `submodule ${subPath}: not repaired (${(r.err || r.out).trim()}); the project's refresh steps may still set it up`,
        );
        continue;
      }
      this.tryRun(['submodule', 'sync', '-q', '--', subPath]); // back to the .gitmodules URL
    }
  }

  /** A submodule is the worktree's own when git, run inside it, says its top level IS that directory. */
  private isOwnSubmodule(wtSub: string, wtGit: string): boolean {
    if (!existsSync(wtGit)) return false;
    const top = new Git(wtSub).tryRun(['rev-parse', '--show-toplevel']);
    if (top.code !== 0) return false;
    return realpathOr(top.out.trim()) === realpathOr(wtSub);
  }
}
