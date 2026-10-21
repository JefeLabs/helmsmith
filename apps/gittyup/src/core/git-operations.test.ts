import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await git.resolveUseOurs(file);
    expect(await repo.exists('f.txt')).toBe(false);
    expect((await repo.git.status()).conflicted).toEqual([]);
    // HEAD (develop) already lacks the file, so "keep ours" leaves it untracked.
    expect((await repo.git.raw(['ls-files', 'f.txt'])).trim()).toBe('');
  });

  it('trusts the loaded ConflictFile and never infers deletion from a git failure', async () => {
    // Stage 2 is absent here; a ConflictFile that claims ours exists must make
    // git fail loudly (checkout --ours), not silently delete the file.
    const repo = await deleteModifyRepo();
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await expect(git.resolveUseOurs({ ...file, ours: 'claimed\n' })).rejects.toThrow();
    expect((await repo.git.status()).conflicted).toEqual(['f.txt']);
  });

  it('keeping the surviving side restores its content and stages it', async () => {
    const repo = await deleteModifyRepo();
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await git.resolveUseTheirs(file);
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

describe('paths that look like globs', () => {
  it('resolves exactly the named file, not a glob match', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'a*.txt': 'x\n', 'ab.txt': 'keep\n' } },
        { branch: 'develop', message: 'ours', files: { 'a*.txt': 'x-ours\n' } },
        { branch: 'main', message: 'theirs', files: { 'a*.txt': 'x-theirs\n' } },
      ],
      checkout: 'develop',
    });
    await repo.git.merge(['main']).catch(() => {});
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await git.resolveUseTheirs(file);
    expect(await repo.read('a*.txt')).toBe('x-theirs\n');
    expect(await repo.read('ab.txt')).toBe('keep\n');
    expect((await repo.git.status()).conflicted).toEqual([]);
  });
});

describe('symlinked conflict paths (S2/S3/G21)', () => {
  async function symlinkConflict() {
    const repo = await makeRepo({
      commits: [{ message: 'base', files: { 'f.txt': 'a\nb\nc\n' } }],
      checkout: 'main',
    });
    // a secret file OUTSIDE the repo that the symlink will point at
    const outside = join(dirname(repo.path), 'secret-outside.txt');
    writeFileSync(outside, 'OUTSIDE-SECRET-1\nOUTSIDE-SECRET-2\n');
    // ours (develop) edits the file
    await repo.git.checkoutLocalBranch('develop');
    writeFileSync(join(repo.path, 'f.txt'), 'a\nB\nc\n');
    await repo.git.add('f.txt');
    await repo.git.commit('ours');
    // theirs (main) replaces the file with a symlink pointing outside the repo
    await repo.git.checkout('main');
    rmSync(join(repo.path, 'f.txt'));
    symlinkSync('../secret-outside.txt', join(repo.path, 'f.txt'));
    await repo.git.add('f.txt');
    await repo.git.commit('symlink');
    await repo.git.checkout('develop');
    await repo.git.merge(['main']).catch(() => {});
    return { repo, outside };
  }

  it('getConflictedFiles does not read the symlink target into markedContent (S3)', async () => {
    const { repo } = await symlinkConflict();
    const [file] = await new GitOperations(repo.path).getConflictedFiles();
    expect(file.path).toBe('f.txt');
    expect(file.markedContent).not.toContain('OUTSIDE-SECRET');
  });

  it('applyResolution refuses to write through a symlink and leaves the outside file untouched (S2/G21)', async () => {
    const { repo, outside } = await symlinkConflict();
    const git = new GitOperations(repo.path);
    const [file] = await git.getConflictedFiles();
    await expect(git.applyResolution(file, 'R1\nR2\nR3\n')).rejects.toThrow();
    expect(readFileSync(outside, 'utf-8')).toBe('OUTSIDE-SECRET-1\nOUTSIDE-SECRET-2\n');
  });
});

describe('keep-side on a gitlink (submodule) conflict (G6)', () => {
  async function gitlinkConflict() {
    // a throwaway repo whose HEAD sha we embed as a gitlink
    const sub = await makeRepo({ commits: [{ message: 's', files: { a: 'x\n' } }] });
    const subSha = (await sub.git.revparse(['HEAD'])).trim();
    const repo = await makeRepo({
      commits: [{ message: 'base', files: { 'base.txt': 'b\n' } }],
      checkout: 'main',
    });
    // develop: add a gitlink at `mod`
    await repo.git.checkoutLocalBranch('develop');
    await repo.git.raw(['update-index', '--add', '--cacheinfo', `160000,${subSha},mod`]);
    await repo.git.commit('add gitlink');
    // main: add a normal file at `mod`
    await repo.git.checkout('main');
    writeFileSync(join(repo.path, 'mod'), 'iamafile\n');
    await repo.git.add('mod');
    await repo.git.commit('add file at mod');
    await repo.git.checkout('develop');
    await repo.git.merge(['main']).catch(() => {});
    return repo;
  }

  it('keeping the gitlink side does not git-rm the submodule', async () => {
    const repo = await gitlinkConflict();
    const git = new GitOperations(repo.path);
    const files = await git.getConflictedFiles();
    const mod = files.find((f) => f.path === 'mod')!;
    expect(mod).toBeTruthy();
    // develop holds the gitlink (stage 2 = ours); keeping ours must preserve the gitlink,
    // not git-rm it as PR #123 did when `git show` could not print the gitlink stage.
    await git.resolveUseOurs(mod);
    const entry = await repo.git.raw(['ls-files', '--stage', '--', 'mod']);
    expect(entry).toMatch(/^160000 /); // still a gitlink, not removed
  });
});

describe('merge/pick refuse the wrong branch (G2)', () => {
  it('merge throws when the target matches a directory but no branch, leaving HEAD put', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'staging/x.txt': 'x\n' } },
        { branch: 'feature', message: 'feat', files: { 'f.txt': 'y\n' } },
      ],
      checkout: 'main',
    });
    const git = new GitOperations(repo.path);
    const before = await git.getCurrentBranch();
    // `staging` is a tracked directory, not a branch: a bare `git checkout staging`
    // restores its files and leaves HEAD on main; the merge must not land on main.
    await expect(git.merge('feature', 'staging')).rejects.toThrow(/not a branch/i);
    expect(await git.getCurrentBranch()).toBe(before);
  });

  it('cherryPick throws when the target is not a branch', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'staging/x.txt': 'x\n' } },
        { branch: 'feature', message: 'feat', files: { 'f.txt': 'y\n' } },
      ],
      checkout: 'main',
    });
    const git = new GitOperations(repo.path);
    const sha = (await repo.git.revparse(['feature'])).trim();
    await expect(git.cherryPick([sha], 'staging')).rejects.toThrow(/not a branch/i);
  });
});

describe('compare correctness (G1, G3)', () => {
  it('hasMergeConflicts: true for a real conflict, false for a clean merge (G1)', async () => {
    const conflict = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'a\n', 'g.txt': 'g\n' } },
        { branch: 'develop', message: 'ours', files: { 'f.txt': 'b\n' } },
        { branch: 'main', message: 'theirs', files: { 'f.txt': 'c\n' } },
      ],
      checkout: 'main',
    });
    expect(await new GitOperations(conflict.path).hasMergeConflicts('main', 'develop')).toBe(true);

    const clean = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'a\n', 'g.txt': 'g\n' } },
        { branch: 'develop', message: 'ours', files: { 'f.txt': 'b\n' } },
        { branch: 'main', message: 'theirs', files: { 'g.txt': 'h\n' } },
      ],
      checkout: 'main',
    });
    expect(await new GitOperations(clean.path).hasMergeConflicts('main', 'develop')).toBe(false);
  });

  it('listCommits reads the named branch, not a range against HEAD (G3)', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'c1', files: { 'f.txt': '1\n' } },
        { branch: 'feature', message: 'c2', files: { 'g.txt': '2\n' } },
      ],
      checkout: 'main',
    });
    // Standing on main, the commits of `feature` are c2 then c1 — not `feature...HEAD` (just c2).
    const commits = await new GitOperations(repo.path).listCommits('feature', 50);
    expect(commits.map((c) => c.message)).toEqual(['c2', 'c1']);
  });
});

describe('withRepoGuard restores the start branch and stash (spec §1.4/§3.2)', () => {
  it('a dirty start branch is restored, with its stash, after a merge onto another branch', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'base\n' } },
        { branch: 'staging', message: 's', files: { 's.txt': 's\n' } },
        { branch: 'develop', from: 'main', message: 'd', files: { 'g.txt': 'd\n' } },
      ],
      checkout: 'main',
    });
    const git = new GitOperations(repo.path);
    // uncommitted edit to a tracked file on the start branch (main)
    writeFileSync(join(repo.path, 'f.txt'), 'DIRTY-ON-MAIN\n');

    await git.withRepoGuard('merge develop → staging', async () => {
      await git.merge('develop', 'staging');
    });

    // back on the branch we started on
    expect(await git.getCurrentBranch()).toBe('main');
    // the uncommitted edit came back on main, not on staging
    expect(readFileSync(join(repo.path, 'f.txt'), 'utf-8')).toBe('DIRTY-ON-MAIN\n');
    // nothing left stashed
    expect((await repo.git.stashList()).all.length).toBe(0);
    // the merge landed on staging (g.txt from develop is present there)
    await repo.git.checkout('staging');
    expect((await repo.git.raw(['ls-files', 'g.txt'])).trim()).toBe('g.txt');
  });
});

describe('cherry-pick of an already-present change is skipped, not failed (G15)', () => {
  it('returns success and leaves no cherry-pick in progress', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'file.txt': 'base\n' } },
        { branch: 'develop', message: 'X', files: { 'file.txt': 'X\n' } },
        // branchB independently arrives at the same content as develop's X commit
        { branch: 'branchB', from: 'main', message: 'same-as-X', files: { 'file.txt': 'X\n' } },
      ],
      checkout: 'main',
    });
    const git = new GitOperations(repo.path);
    const sx = (await repo.git.revparse(['develop'])).trim();
    const result = await git.cherryPick([sx], 'branchB');
    expect(result.success).toBe(true);
    // the empty pick was dropped, not left dangling mid-cherry-pick
    expect(existsSync(join(repo.path, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
    expect((await repo.git.status()).conflicted).toEqual([]);
  });
});

describe('refuses to start on a repo mid-operation (G12)', () => {
  it('withRepoGuard throws and does not run the operation when a merge is in progress', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'a\n' } },
        { branch: 'develop', message: 'ours', files: { 'f.txt': 'b\n' } },
        { branch: 'main', message: 'theirs', files: { 'f.txt': 'c\n' } },
      ],
      checkout: 'main',
    });
    // leave a real conflicted merge in progress (MERGE_HEAD + unmerged index)
    await repo.git.merge(['develop']).catch(() => {});
    const git = new GitOperations(repo.path);
    let ran = false;
    await expect(
      git.withRepoGuard('x', async () => {
        ran = true;
      }),
    ).rejects.toThrow(/in progress|unmerged|MERGE_HEAD/i);
    expect(ran).toBe(false);
  });
});
