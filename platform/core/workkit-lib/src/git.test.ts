import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { commitFile, makeRepo } from './testing/fixture-repo.js';

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
});
