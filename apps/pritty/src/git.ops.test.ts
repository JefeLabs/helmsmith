import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGit } from './git.js';
import { commitFile, gitIn, headFile, makeRepo, stagedPaths, write } from './testing/repo.js';

describe('GitOps.commit with a file subset commits index content, never the working tree', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('commits the staged version of a file that was modified again after staging', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    commitFile(r.dir, 'a.txt', '1\n2\n3\n', 'a');
    write(r.dir, 'a.txt', '1x\n2\n3\n');
    gitIn(r.dir, 'add', 'a.txt');
    write(r.dir, 'a.txt', '1x\n2\n3y\n'); // not staged

    await createGit(r.dir).commit('feat: a', ['a.txt']);

    expect(headFile(r.dir, 'a.txt')).toBe('1x\n2\n3\n');
    expect(readFileSync(join(r.dir, 'a.txt'), 'utf8')).toBe('1x\n2\n3y\n');
    expect(gitIn(r.dir, 'status', '--porcelain').trimEnd()).toBe(' M a.txt');
  });

  it('leaves a staged file outside the subset staged', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    write(r.dir, 'a.txt', 'A\n');
    write(r.dir, 'b.txt', 'B\n');
    gitIn(r.dir, 'add', 'a.txt', 'b.txt');

    await createGit(r.dir).commit('feat: a', ['a.txt']);

    expect(headFile(r.dir, 'a.txt')).toBe('A\n');
    expect(headFile(r.dir, 'b.txt')).toBeNull();
    expect(stagedPaths(r.dir)).toEqual(['b.txt']);
  });

  it('does not pick up a path in the subset that has no staged change', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    commitFile(r.dir, 'secret.env', 'old\n', 'secret');
    write(r.dir, 'secret.env', 'LEAKED\n'); // modified, never staged
    write(r.dir, 'a.txt', 'A\n');
    gitIn(r.dir, 'add', 'a.txt');

    await createGit(r.dir).commit('feat: a', ['a.txt', 'secret.env']);

    expect(headFile(r.dir, 'secret.env')).toBe('old\n');
    expect(headFile(r.dir, 'a.txt')).toBe('A\n');
  });

  it('commits a staged deletion', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    commitFile(r.dir, 'gone.txt', 'x\n', 'gone');
    gitIn(r.dir, 'rm', '-q', 'gone.txt');

    await createGit(r.dir).commit('chore: remove', ['gone.txt']);

    expect(headFile(r.dir, 'gone.txt')).toBeNull();
    expect(gitIn(r.dir, 'status', '--porcelain').trim()).toBe('');
  });

  it('still runs the pre-commit hook', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    const hook = join(r.dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    chmodSync(hook, 0o755);
    write(r.dir, 'a.txt', 'A\n');
    gitIn(r.dir, 'add', 'a.txt');
    const before = gitIn(r.dir, 'rev-parse', 'HEAD');

    await expect(createGit(r.dir).commit('feat: a', ['a.txt'])).rejects.toThrow();

    expect(gitIn(r.dir, 'rev-parse', 'HEAD')).toBe(before);
    expect(stagedPaths(r.dir)).toEqual(['a.txt']);
  });

  it('refuses a subset with nothing staged instead of committing everything', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    write(r.dir, 'a.txt', 'A\n');
    gitIn(r.dir, 'add', 'a.txt');
    const before = gitIn(r.dir, 'rev-parse', 'HEAD');

    await expect(createGit(r.dir).commit('feat: nothing', ['missing.txt'])).rejects.toThrow(
      /nothing staged/,
    );

    expect(gitIn(r.dir, 'rev-parse', 'HEAD')).toBe(before);
  });
});

describe('GitOps.rebaseWithPlan', () => {
  let cleanup = () => {};
  const savedEnv = { GIT_EDITOR: process.env.GIT_EDITOR, PAGER: process.env.PAGER };
  afterEach(() => {
    cleanup();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function threeCommits(): { dir: string; hashes: string[] } {
    const r = makeRepo();
    cleanup = r.cleanup;
    commitFile(r.dir, 'f1', '1\n', 'c1');
    commitFile(r.dir, 'f2', '2\n', 'c2');
    commitFile(r.dir, 'f3', '3\n', 'c3');
    const hashes = gitIn(r.dir, 'rev-list', '--reverse', 'HEAD~3..HEAD').trim().split('\n');
    return { dir: r.dir, hashes };
  }

  it('runs even when the user environment carries an editor and a pager', async () => {
    process.env.GIT_EDITOR = 'vim';
    process.env.PAGER = 'less';
    const { dir, hashes } = threeCommits();
    const todo = `pick ${hashes[0]}\npick ${hashes[1]}\npick ${hashes[2]}\n`;

    const result = await createGit(dir).rebaseWithPlan('HEAD~3', todo);

    expect(result).toMatchObject({ ok: true });
    expect(gitIn(dir, 'log', '--format=%s', 'HEAD~3..HEAD').trim().split('\n')).toEqual([
      'c3',
      'c2',
      'c1',
    ]);
  });

  it('applies a reword and a squash run with the planned messages', async () => {
    const { dir, hashes } = threeCommits();
    const todo = [
      `pick ${hashes[0]}`,
      "exec git commit --amend -m 'feat: one'",
      `pick ${hashes[1]}`,
      `fixup ${hashes[2]}`,
      "exec git commit --amend -m 'feat: two and three'",
      '',
    ].join('\n');

    const result = await createGit(dir).rebaseWithPlan('HEAD~3', todo);

    expect(result).toMatchObject({ ok: true });
    expect(gitIn(dir, 'log', '--format=%s', 'HEAD~2..HEAD').trim().split('\n')).toEqual([
      'feat: two and three',
      'feat: one',
    ]);
    expect(gitIn(dir, 'show', '--stat', '--format=', 'HEAD')).toMatch(/f2[\s\S]*f3/);
  });

  it('reports a conflict as not ok and leaves the rebase in progress for the user', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    commitFile(r.dir, 'f', 'base\n', 'base');
    commitFile(r.dir, 'f', 'one\n', 'c1');
    commitFile(r.dir, 'f', 'two\n', 'c2');
    const hashes = gitIn(r.dir, 'rev-list', '--reverse', 'HEAD~2..HEAD').trim().split('\n');

    const result = await createGit(r.dir).rebaseWithPlan(
      'HEAD~2',
      `pick ${hashes[1]}\npick ${hashes[0]}\n`,
    );

    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/conflict/i);
    expect(gitIn(r.dir, 'status').toLowerCase()).toContain('rebase in progress');
    gitIn(r.dir, 'rebase', '--abort');
  });
});

describe('GitOps ranges against a base that moved after the branch point', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  function diverged(): string {
    const r = makeRepo();
    cleanup = r.cleanup;
    gitIn(r.dir, 'checkout', '-q', '-b', 'feat');
    commitFile(r.dir, 'feat.txt', 'f\n', 'feat: mine');
    gitIn(r.dir, 'checkout', '-q', 'main');
    commitFile(r.dir, 'main-only.txt', 'm\n', 'chore: landed on main meanwhile');
    gitIn(r.dir, 'checkout', '-q', 'feat');
    return r.dir;
  }

  it('log lists only commits reachable from head and not from base', async () => {
    const dir = diverged();
    const commits = await createGit(dir).log('main');
    expect(commits.map((c) => c.subject)).toEqual(['feat: mine']);
  });

  it('changedFilesBetween lists only files the branch changed since the merge base', async () => {
    const dir = diverged();
    expect(await createGit(dir).changedFilesBetween('main')).toEqual(['feat.txt']);
  });

  it('resolveBaseRef prefers the remote-tracking ref when origin has the base', async () => {
    const dir = diverged();
    expect(await createGit(dir).resolveBaseRef('main')).toBe('main');
    const origin = `${dir}-origin.git`;
    gitIn(dir, 'init', '-q', '--bare', origin);
    gitIn(dir, 'remote', 'add', 'origin', origin);
    gitIn(dir, 'push', '-q', 'origin', 'main');
    expect(await createGit(dir).resolveBaseRef('main')).toBe('origin/main');
    expect(await createGit(dir).resolveBaseRef('nope')).toBe('nope');
  });
});

describe('GitOps.rebaseWithPlan with a rendered multi-line message', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('applies the whole message, body included', async () => {
    const r = makeRepo();
    cleanup = r.cleanup;
    commitFile(r.dir, 'f1', '1\n', 'c1');
    const hash = gitIn(r.dir, 'rev-parse', 'HEAD').trim();
    const { renderRebaseTodo } = await import('./commands/_shared/format.js');
    const message = "fix: don't break\n\nSecond paragraph with 100% and a \\ backslash.";
    const todo = renderRebaseTodo([{ hash, action: 'reword', message }]);

    const result = await createGit(r.dir).rebaseWithPlan('HEAD~1', todo);

    expect(result).toMatchObject({ ok: true });
    expect(gitIn(r.dir, 'log', '-1', '--format=%B').trimEnd()).toBe(message);
  });
});
