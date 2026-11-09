/**
 * Git primitives the headless (`--json`) merge/pick flows are built on.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeConflictRepo } from '../test/conflict-fixture.js';
import { cleanupFixtures } from '../test/git-fixture.js';
import { GitOperations } from './git-operations.js';

afterAll(cleanupFixtures);

const TRAILER = 'Resolved-by: gittyup agent (m)';

describe('revParse', () => {
  it('returns the full sha, and rejects an unknown ref', async () => {
    const repo = await makeConflictRepo();
    const git = new GitOperations(repo.path);

    const sha = await git.revParse('main');

    expect(sha).toBe(await repo.sha('main'));
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    await expect(git.revParse('nope')).rejects.toThrow();
  });
});

describe('isAncestor', () => {
  it('is true only when the first commit is in the second one’s history', async () => {
    const { path, c } = await makeConflictRepo();
    const git = new GitOperations(path);

    expect(await git.isAncestor(c.addA, c.changeF)).toBe(true);
    expect(await git.isAncestor(c.changeF, c.addA)).toBe(false);
    expect(await git.isAncestor(c.addG, c.addA)).toBe(false);
  });
});

describe('resetHard', () => {
  it('moves the branch and the working tree back to the given commit', async () => {
    const repo = await makeConflictRepo();
    const git = new GitOperations(repo.path);
    const base = await repo.sha('main~1');

    await git.switchToBranch('main');
    await git.resetHard(base);

    expect(await git.revParse('HEAD')).toBe(base);
    expect(await repo.read('f.txt')).toBe('a\nb\nc\n');
  });
});

describe('pickOne', () => {
  it('applies a commit, then reports the same commit again as dropped', async () => {
    const repo = await makeConflictRepo();
    const git = new GitOperations(repo.path);
    await git.switchToBranch('main');

    expect(await git.pickOne(repo.c.addA)).toBe('applied');
    expect(await repo.exists('a.txt')).toBe(true);

    const head = await git.revParse('HEAD');
    expect(await git.pickOne(repo.c.addA)).toBe('dropped');
    expect(await git.revParse('HEAD')).toBe(head);
  });

  it('reports a conflict and leaves the pick in progress', async () => {
    const repo = await makeConflictRepo();
    const git = new GitOperations(repo.path);
    await git.switchToBranch('main');

    expect(await git.pickOne(repo.c.changeF)).toBe('conflict');
    await expect(repo.git.raw(['rev-parse', '--verify', 'CHERRY_PICK_HEAD'])).resolves.toBeTruthy();
  });

  it('throws for a commit that does not exist', async () => {
    const repo = await makeConflictRepo();
    const git = new GitOperations(repo.path);
    await git.switchToBranch('main');

    await expect(git.pickOne('0'.repeat(40))).rejects.toMatchObject({
      message: expect.stringMatching(/cherry-pick failed/),
    });
  });
});

describe('finishResolvedCommit', () => {
  it('finishes a resolved pick with the original author and message plus the trailer', async () => {
    const repo = await makeConflictRepo();
    await repo.git.addConfig('user.name', 'resolver');
    const git = new GitOperations(repo.path);
    await git.switchToBranch('main');
    expect(await git.pickOne(repo.c.changeF)).toBe('conflict');
    writeFileSync(join(repo.path, 'f.txt'), 'a\nRESOLVED\nc\n');
    await repo.git.add('f.txt');

    const sha = await git.finishResolvedCommit(TRAILER);

    expect(sha).toBe(await repo.sha('main'));
    const who = (await repo.git.raw(['log', '-1', '--format=%an|%cn'])).trim();
    expect(who).toBe('gittyup-fixture|resolver');
    const body = (await repo.git.raw(['log', '-1', '--format=%B'])).trimEnd();
    expect(body).toBe(`feat: b becomes FEATURE\n\n${TRAILER}`);
    await expect(repo.git.raw(['rev-parse', '--verify', 'CHERRY_PICK_HEAD'])).rejects.toThrow();
  });

  it('finishes a resolved merge as a two-parent commit keeping git’s merge message', async () => {
    const repo = await makeConflictRepo();
    const git = new GitOperations(repo.path);
    expect((await git.merge('feature', 'main')).success).toBe(false);
    writeFileSync(join(repo.path, 'f.txt'), 'a\nRESOLVED\nc\n');
    await repo.git.add('f.txt');

    await git.finishResolvedCommit(TRAILER);

    const parents = (await repo.git.raw(['log', '-1', '--format=%P'])).trim().split(' ');
    expect(parents).toHaveLength(2);
    const body = (await repo.git.raw(['log', '-1', '--format=%B'])).trimEnd();
    expect(body.startsWith("Merge branch 'feature'")).toBe(true);
    expect(body.endsWith(TRAILER)).toBe(true);
  });
});
