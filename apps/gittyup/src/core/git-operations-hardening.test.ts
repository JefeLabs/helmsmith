import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, makeRepo } from '../test/git-fixture.js';
import { GitOperations } from './git-operations.js';

afterEach(() => cleanupFixtures());

describe('untrusted-repo git hardening (S1)', () => {
  it('does not run a repo-configured core.fsmonitor command when inspecting state', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    const marker = join(repo.path, 'FSMONITOR-RAN');
    const hook = join(repo.path, 'fsm.sh');
    writeFileSync(hook, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
    chmodSync(hook, 0o755);
    // A hostile repo ships this in its own config. Set it with raw git (a clone carries it
    // in .git/config); simple-git would refuse to *set* it, but git still *runs* it.
    execFileSync('git', ['-C', repo.path, 'config', 'core.fsmonitor', hook]);

    const git = new GitOperations(repo.path);
    await git.getStatus();
    await git.getBranchState('main').catch(() => {});

    expect(existsSync(marker)).toBe(false);
  });
});

describe('option-like refs are refused (S5)', () => {
  it('getBranchState rejects a branch name that starts with a dash', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    const git = new GitOperations(repo.path);
    await expect(git.getBranchState('--output=/tmp/pwned')).rejects.toThrow(
      /refus|invalid|option/i,
    );
  });

  it('merge rejects an option-like source or target branch', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    const git = new GitOperations(repo.path);
    await expect(git.merge('main', '--output=/tmp/pwned')).rejects.toThrow(/refus|invalid|option/i);
    await expect(git.merge('--upload-pack=evil', 'main')).rejects.toThrow(/refus|invalid|option/i);
  });
});

describe('option-like refs refused on the remaining ref-taking methods (S5 follow-up)', () => {
  async function repo() {
    const r = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    return new GitOperations(r.path);
  }
  it('listCommits rejects an option-like branch', async () => {
    await expect((await repo()).listCommits('--output=/tmp/pwned')).rejects.toThrow(/option-like/);
  });
  it('checkout rejects an option-like branch', async () => {
    await expect((await repo()).checkout('--foo')).rejects.toThrow(/option-like/);
  });
  it('push rejects an option-like remote or branch', async () => {
    const git = await repo();
    await expect(git.push('--upload-pack=evil', 'main')).rejects.toThrow(/option-like/);
    await expect(git.push('origin', '--foo')).rejects.toThrow(/option-like/);
  });
  it('branchExists returns false for an option-like name without executing it', async () => {
    expect(await (await repo()).branchExists('--output=/tmp/pwned')).toBe(false);
  });
});
