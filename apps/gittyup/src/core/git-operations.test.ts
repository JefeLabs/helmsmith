import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, makeRepo } from '../test/git-fixture.js';
import { GitOperations, parseConflictHunks } from './git-operations.js';

afterEach(() => cleanupFixtures());

const EIGHT = (l4: string) => `line1\nline2\nline3\n${l4}\nline5\nline6\nline7\nline8\n`;

async function conflictedRepo(
  files: { base: string; ours: string; theirs: string },
  path = 'f.txt',
) {
  const repo = await makeRepo({
    commits: [
      { message: 'base', files: { [path]: files.base } },
      { branch: 'develop', message: 'ours', files: { [path]: files.ours } },
      { branch: 'main', message: 'theirs', files: { [path]: files.theirs } },
    ],
    checkout: 'develop',
  });
  await repo.git.merge(['main']).catch(() => {});
  return repo;
}

async function deleteModifyRepo() {
  const repo = await makeRepo({
    commits: [
      { message: 'base', files: { 'f.txt': 'x\n' } },
      { branch: 'develop', message: 'delete', files: { 'f.txt': null } },
      { branch: 'main', message: 'modify', files: { 'f.txt': 'x-main\n' } },
    ],
    checkout: 'develop',
  });
  await repo.git.merge(['main']).catch(() => {});
  return repo;
}

describe('getConflictedFiles', () => {
  it('returns the full file for each side, not just the hunk', async () => {
    const repo = await conflictedRepo({
      base: EIGHT('line4'),
      ours: EIGHT('line4-ours'),
      theirs: EIGHT('line4-theirs'),
    });
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.path).toBe('f.txt');
    expect(file.ours).toBe(EIGHT('line4-ours'));
    expect(file.theirs).toBe(EIGHT('line4-theirs'));
    expect(file.base).toBe(EIGHT('line4'));
    expect(file.markedContent).toContain('<<<<<<< HEAD');
    expect(file.hunks).toEqual([{ ours: 'line4-ours', theirs: 'line4-theirs' }]);
  });

  it('parses two hunks in one file', async () => {
    const repo = await conflictedRepo({
      base: 'a\nb\nc\nd\ne\nf\ng\n',
      ours: 'a-ours\nb\nc\nd\ne\nf\ng-ours\n',
      theirs: 'a-theirs\nb\nc\nd\ne\nf\ng-theirs\n',
    });
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.hunks).toHaveLength(2);
    expect(file.hunks[1]).toEqual({ ours: 'g-ours', theirs: 'g-theirs' });
  });

  it('leaves a deleted side undefined (delete/modify)', async () => {
    const repo = await deleteModifyRepo();
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.ours).toBeUndefined();
    expect(file.theirs).toBe('x-main\n');
    expect(file.base).toBe('x\n');
    expect(file.hunks).toEqual([]);
  });

  it('reads stages for a nested path with spaces', async () => {
    const path = 'src/a b/f.txt';
    const repo = await conflictedRepo(
      { base: 'x\n', ours: 'x-ours\n', theirs: 'x-theirs\n' },
      path,
    );
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.path).toBe(path);
    expect(file.ours).toBe('x-ours\n');
  });
});

describe('parseConflictHunks', () => {
  it('parses hunks in a CRLF file', () => {
    const marked = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> main\r\nz\r\n';
    expect(parseConflictHunks(marked)).toEqual([{ ours: 'ours', theirs: 'theirs' }]);
  });

  it('captures the base section of a diff3-style hunk', () => {
    const marked = '<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> main\n';
    expect(parseConflictHunks(marked)).toEqual([{ ours: 'ours', theirs: 'theirs', base: 'base' }]);
  });
});

describe('resolveUseOurs / resolveUseTheirs with a deleted side', () => {
  it('keeping the deleted side removes the file and stages the deletion', async () => {
    const repo = await deleteModifyRepo();
    await new GitOperations(repo.path).resolveUseOurs('f.txt');
    expect(await repo.exists('f.txt')).toBe(false);
    expect((await repo.git.status()).conflicted).toEqual([]);
    // HEAD (develop) already lacks the file, so "keep ours" leaves it untracked.
    expect((await repo.git.raw(['ls-files', 'f.txt'])).trim()).toBe('');
  });

  it('keeping the surviving side restores its content and stages it', async () => {
    const repo = await deleteModifyRepo();
    await new GitOperations(repo.path).resolveUseTheirs('f.txt');
    expect(await repo.read('f.txt')).toBe('x-main\n');
    expect((await repo.git.status()).conflicted).toEqual([]);
  });
});

describe('applyResolution', () => {
  it('writes and stages a gated resolution', async () => {
    const repo = await conflictedRepo({
      base: EIGHT('line4'),
      ours: EIGHT('line4-ours'),
      theirs: EIGHT('line4-theirs'),
    });
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await git.applyResolution(file, EIGHT('line4-merged'));
    expect(await repo.read('f.txt')).toBe(EIGHT('line4-merged'));
    expect((await repo.git.status()).conflicted).toEqual([]);
  });

  it('refuses a fragment and leaves the file untouched', async () => {
    const repo = await conflictedRepo({
      base: EIGHT('line4'),
      ours: EIGHT('line4-ours'),
      theirs: EIGHT('line4-theirs'),
    });
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await expect(git.applyResolution(file, 'line4-merged')).rejects.toMatchObject({
      reason: 'single line where both sides are multi-line',
    });
    expect(await repo.read('f.txt')).toBe(file.markedContent);
    expect((await repo.git.status()).conflicted).toEqual(['f.txt']);
  });
});
