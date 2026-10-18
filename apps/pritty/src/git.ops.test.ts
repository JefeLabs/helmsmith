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
