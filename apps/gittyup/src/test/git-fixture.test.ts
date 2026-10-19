import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, makeRepo } from './git-fixture.js';

afterEach(() => cleanupFixtures());

describe('makeRepo', () => {
  it('builds commits on the default branch in order', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'a\n' } },
        { message: 'second', files: { 'f.txt': 'a\nb\n', 'g.txt': 'g\n' } },
      ],
    });
    expect(await repo.currentBranch()).toBe('main');
    const log = await repo.git.log();
    expect(log.all.map((c) => c.message)).toEqual(['second', 'base']);
    expect(await repo.read('f.txt')).toBe('a\nb\n');
  });

  it('cuts a new branch from the current HEAD when from is omitted', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev1', files: { 'f.txt': 'x-dev\n' } },
      ],
      checkout: 'develop',
    });
    expect(await repo.sha('develop~1')).toBe(await repo.sha('main'));
    expect(await repo.currentBranch()).toBe('develop');
  });

  it('cuts a new branch from `from` when given', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev1', files: { 'f.txt': 'x-dev\n' } },
        { branch: 'hotfix', from: 'main', message: 'fix', files: { 'h.txt': 'h\n' } },
      ],
    });
    expect(await repo.sha('hotfix~1')).toBe(await repo.sha('main'));
    expect(await repo.sha('hotfix~1')).not.toBe(await repo.sha('develop'));
  });

  it('deletes a file when the value is null', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n', 'g.txt': 'g\n' } },
        { message: 'rm g', files: { 'g.txt': null } },
      ],
    });
    expect(await repo.exists('g.txt')).toBe(false);
    const show = await repo.git.raw(['show', '--name-status', '--format=', 'HEAD']);
    expect(show).toMatch(/^D\s+g\.txt/m);
  });

  it('produces a real conflict when both branches edit the same line', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'l1\nl2\nl3\n' } },
        { branch: 'develop', message: 'ours', files: { 'f.txt': 'l1\nl2-ours\nl3\n' } },
        { branch: 'main', message: 'theirs', files: { 'f.txt': 'l1\nl2-theirs\nl3\n' } },
      ],
      checkout: 'develop',
    });
    await expect(repo.git.merge(['main'])).rejects.toThrow();
    const status = await repo.git.status();
    expect(status.conflicted).toEqual(['f.txt']);
  });

  it('creates a bare origin and pushes every branch when remote is true', async () => {
    const repo = await makeRepo({
      remote: true,
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev', files: { 'f.txt': 'y\n' } },
      ],
    });
    expect(repo.remotePath).toBeDefined();
    const remotes = await repo.git.getRemotes(true);
    expect(remotes[0]).toMatchObject({ name: 'origin' });
    expect(await repo.sha('origin/develop')).toBe(await repo.sha('develop'));
    expect(await repo.sha('origin/main')).toBe(await repo.sha('main'));
  });

  it("ignores the developer's global git config", async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    const name = await repo.git.raw(['log', '-1', '--format=%an <%ae>']);
    expect(name.trim()).toBe('gittyup-fixture <fixture@gittyup.test>');
    const signed = await repo.git.raw(['log', '-1', '--format=%G?']);
    expect(signed.trim()).toBe('N');
  });

  it('cleans up registered repos', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    expect(existsSync(repo.path)).toBe(true);
    await cleanupFixtures();
    expect(existsSync(repo.path)).toBe(false);
  });
});
