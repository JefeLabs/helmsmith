import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { commitFile, gitIn, makeRepo } from './testing/fixture-repo.js';

describe('Git', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('knows the main checkout from a linked worktree', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const g = new Git(f.main);
    expect(g.isMainCheckout()).toBe(true);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    g.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    expect(new Git(wt).isMainCheckout()).toBe(false);
    expect(new Git(wt).currentBranch()).toBe('feature/shop/cart');
    expect(new Git(wt).root()).toBe(realpathSync(wt));
    expect(new Git(wt).mainRoot()).toBe(realpathSync(f.main));
  });

  it('syncFrom fast-forwards, merges, or reports a conflict and leaves it in place', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const g = new Git(f.main);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    g.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    const w = new Git(wt);
    expect(w.syncFrom('develop').kind).toBe('up-to-date');
    commitFile(f.main, 'a.txt', 'two', 'develop moves');
    g.push('develop');
    w.fetch('develop');
    expect(w.syncFrom('develop').kind).toBe('ff');
    commitFile(wt, 'b.txt', 'mine', 'own work');
    commitFile(f.main, 'c.txt', 'theirs', 'develop again');
    g.push('develop');
    w.fetch('develop');
    expect(w.syncFrom('develop').kind).toBe('merge');
    commitFile(wt, 'a.txt', 'mine-a', 'edit a');
    commitFile(f.main, 'a.txt', 'theirs-a', 'edit a too');
    g.push('develop');
    w.fetch('develop');
    const r = w.syncFrom('develop');
    expect(r.kind).toBe('conflict');
    expect(r.conflicted).toEqual(['a.txt']);
    expect(w.tryRun(['rev-parse', '--verify', '-q', 'MERGE_HEAD']).code).toBe(0);
  });

  it('counts unpushed commits, lists changed paths and own commits', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const g = new Git(f.main);
    commitFile(f.main, 'x/y.txt', '1', 'x');
    expect(g.unpushedCount('develop')).toBe(1);
    expect(g.changedPaths('origin/develop', 'HEAD')).toEqual(['x/y.txt']);
    expect(g.commitsNotOn('develop')).toHaveLength(1);
    g.push('develop');
    expect(g.unpushedCount('develop')).toBe(0);
    expect(g.isDirty()).toBe(false);
  });

  it('checkout creates a branch from a start point and removes worktrees and branches', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const g = new Git(f.main);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    g.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    const w = new Git(wt);
    w.checkout('fix/shop/cart', 'origin/develop');
    expect(w.currentBranch()).toBe('fix/shop/cart');
    expect(g.branchExists('fix/shop/cart')).toBe(true);
    expect(g.remoteBranchExists('fix/shop/cart')).toBe(false);
    g.worktreeRemove(wt);
    g.deleteLocalBranch('fix/shop/cart');
    expect(g.branchExists('fix/shop/cart')).toBe(false);
  });

  it("changedSince lists only this branch's own changes, and new branches do not track the base", () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const g = new Git(f.main);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    g.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    const w = new Git(wt);
    expect(w.hasUpstream()).toBe(false);
    commitFile(wt, 'mine.txt', '1', 'mine');
    commitFile(f.main, 'theirs.txt', '1', 'theirs');
    g.push('develop');
    w.fetch('develop');
    expect(w.changedPaths('origin/develop', 'HEAD').sort()).toEqual(['mine.txt', 'theirs.txt']);
    expect(w.changedSince('develop')).toEqual(['mine.txt']);
    w.checkout('fix/shop/cart', 'origin/develop');
    expect(w.hasUpstream()).toBe(false);
  });

  it('knows a main checkout whose path contains /worktrees/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wk-git-'));
    const main = join(dir, 'worktrees', 'main');
    mkdirSync(main, { recursive: true });
    cleanup = () => rmSync(dir, { recursive: true, force: true });
    new Git(dir).run(['init', '-q', '-b', 'develop', main]);
    expect(new Git(main).isMainCheckout()).toBe(true);
  });

  it('detects squash-merged equivalence to base and ancestor relationships', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const main = new Git(f.main);
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    main.worktreeAdd(wt, 'feature/shop/cart', 'origin/develop');
    const w = new Git(wt);
    commitFile(wt, 'cart1.txt', '1', 'c1');
    commitFile(wt, 'cart2.txt', '2', 'c2');
    expect(w.isEquivalentToBase('develop')).toBe(false);
    commitFile(f.main, 'cart1.txt', '1', 'squash');
    commitFile(f.main, 'cart2.txt', '2', 'squash-2');
    main.push('develop');
    w.fetch('develop');
    expect(w.commitsNotOn('develop').length).toBeGreaterThan(0);
    expect(w.isEquivalentToBase('develop')).toBe(true);
    expect(w.isAncestor('origin/develop', 'origin/develop')).toBe(true);
  });

  it("repairSubmodules gives the worktree its own submodule and never touches the main checkout's", () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const dir = dirname(f.main);
    // a submodule source, added to the main checkout the way skoolscout has .scripts/.docs
    const subSrc = join(dir, 'sub-src');
    gitIn(dir, 'init', '-q', '-b', 'main', subSrc);
    commitFile(subSrc, 'tool.sh', 'v1', 'sub1');
    gitIn(f.main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSrc, 'scripts');
    gitIn(f.main, 'commit', '-q', '-m', 'add submodule');
    gitIn(f.main, 'config', 'submodule.recurse', 'true');
    // the human has an uncommitted edit inside the main checkout's submodule
    writeFileSync(join(f.main, 'scripts/tool.sh'), 'EDITED-UNCOMMITTED');

    const wt = join(f.main, '.claude/worktrees/shop/cart');
    new Git(f.main).worktreeAdd(wt, 'feature/shop/cart', 'develop');
    new Git(wt).repairSubmodules(f.main);

    expect(readFileSync(join(f.main, 'scripts/tool.sh'), 'utf8')).toBe('EDITED-UNCOMMITTED');
    expect(readFileSync(join(wt, 'scripts/tool.sh'), 'utf8')).toBe('v1');
    const subTop = realpathSync(gitIn(join(wt, 'scripts'), 'rev-parse', '--show-toplevel').trim());
    expect(subTop).toBe(realpathSync(join(wt, 'scripts')));

    // idempotent: a second start on the same worktree repairs nothing and still leaves the main checkout alone
    new Git(wt).repairSubmodules(f.main);
    expect(readFileSync(join(f.main, 'scripts/tool.sh'), 'utf8')).toBe('EDITED-UNCOMMITTED');
    expect(readFileSync(join(wt, 'scripts/tool.sh'), 'utf8')).toBe('v1');
  });

  it('repairSubmodules replaces a gitfile borrowed from the main checkout (the shape the old repair left behind)', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const dir = dirname(f.main);
    const subSrc = join(dir, 'sub-src');
    gitIn(dir, 'init', '-q', '-b', 'main', subSrc);
    commitFile(subSrc, 'tool.sh', 'v1', 'sub1');
    gitIn(f.main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSrc, 'scripts');
    gitIn(f.main, 'commit', '-q', '-m', 'add submodule');
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    new Git(f.main).worktreeAdd(wt, 'feature/shop/cart', 'develop');
    // what the previous repair wrote: a gitfile aimed at the main checkout's module directory
    const mainModule = gitIn(
      join(f.main, 'scripts'),
      'rev-parse',
      '--path-format=absolute',
      '--git-dir',
    ).trim();
    mkdirSync(join(wt, 'scripts'), { recursive: true });
    writeFileSync(join(wt, 'scripts/.git'), `gitdir: ${mainModule}\n`);
    writeFileSync(join(f.main, 'scripts/tool.sh'), 'EDITED-UNCOMMITTED');

    new Git(wt).repairSubmodules(f.main);

    expect(readFileSync(join(f.main, 'scripts/tool.sh'), 'utf8')).toBe('EDITED-UNCOMMITTED');
    expect(readFileSync(join(wt, 'scripts/tool.sh'), 'utf8')).toBe('v1');
    const subTop = realpathSync(gitIn(join(wt, 'scripts'), 'rev-parse', '--show-toplevel').trim());
    expect(subTop).toBe(realpathSync(join(wt, 'scripts')));
    expect(gitIn(join(wt, 'scripts'), 'remote', 'get-url', 'origin').trim()).toBe(subSrc);
  });

  it('repairSubmodules refuses a submodule name that escapes the modules directory', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const dir = dirname(f.main);
    const subSrc = join(dir, 'sub-src');
    gitIn(dir, 'init', '-q', '-b', 'main', subSrc);
    commitFile(subSrc, 'tool.sh', 'v1', 'sub1');
    gitIn(f.main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSrc, 'scripts');
    gitIn(f.main, 'commit', '-q', '-m', 'add submodule');
    const wt = join(f.main, '.claude/worktrees/shop/cart');
    new Git(f.main).worktreeAdd(wt, 'feature/shop/cart', 'develop');
    // a hostile .gitmodules: same path and url, but a name that walks up out of <git-dir>/modules
    writeFileSync(
      join(wt, '.gitmodules'),
      `[submodule "../../victim"]\n\tpath = scripts\n\turl = ${subSrc}\n`,
    );
    const wtGitDir = gitIn(wt, 'rev-parse', '--path-format=absolute', '--git-dir').trim();
    const victim = join(wtGitDir, 'modules', '../../victim');
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, 'keep'), 'x');

    new Git(wt).repairSubmodules(f.main);

    expect(readFileSync(join(victim, 'keep'), 'utf8')).toBe('x');
  });
});
