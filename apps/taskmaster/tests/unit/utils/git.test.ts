import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectGitRoot, getRepoTaskmasterHome } from '../../../src/utils/git.js';

describe('detectGitRoot', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'agentx-git-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null for a directory that is not a git repo', async () => {
    const result = await detectGitRoot(tmpDir);
    expect(result).toBeNull();
  });

  it('returns the git root when run from a git repo (this repo)', async () => {
    // Use the actual project root — we know it's a git repo
    const result = await detectGitRoot(process.cwd());
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('trims trailing whitespace from git output', async () => {
    // detectGitRoot trims stdout — if we get a result, it should not end with \n
    const result = await detectGitRoot(process.cwd());
    if (result) {
      expect(result.endsWith('\n')).toBe(false);
      expect(result.endsWith(' ')).toBe(false);
    }
  });

  it('uses process.cwd() when no cwd argument provided', async () => {
    // Just verify it doesn't throw and returns a consistent result
    const result = await detectGitRoot();
    // We're running inside a git repo, so this should succeed
    expect(result).not.toBeNull();
  });
});

describe('getRepoTaskmasterHome', () => {
  it('returns the repo-local taskmaster home path', () => {
    const result = getRepoTaskmasterHome('/home/user/my-repo');
    expect(result).toBe(join('/home/user/my-repo', '.agentx', 'taskmaster'));
  });

  it('builds correct nested path structure', () => {
    const result = getRepoTaskmasterHome('/tmp/project');
    expect(result).toContain('.agentx');
    expect(result).toContain('taskmaster');
    expect(result).toBe('/tmp/project/.agentx/taskmaster');
  });
});
