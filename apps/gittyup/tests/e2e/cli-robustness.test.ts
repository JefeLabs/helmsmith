/**
 * C1: a confirmation-gated command must not silently proceed or hang without a terminal.
 * C3: the documented quick start (repo add <path>, then status) must register a repo whose
 * path actually resolves, not one relative to the config directory.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureEnv } from '../../src/test/git-fixture.js';
import { createWorkspace, runCli, type Workspace } from './helpers.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: fixtureEnv(), stdio: 'pipe' });
}

describe('non-TTY confirmation gate (C1)', () => {
  let ws: Workspace;
  let repoPath: string;
  afterEach(() => ws?.cleanup());
  beforeEach(async () => {
    ws = await createWorkspace();
    repoPath = join(ws.dir, 'repoA');
    await mkdir(repoPath, { recursive: true });
    git(repoPath, ['init', '-q', '-b', 'main']);
    await writeFile(join(repoPath, 'f.txt'), 'x\n');
    git(repoPath, ['add', '.']);
    git(repoPath, ['commit', '-qm', 'base']);
    await ws.writeManifest({
      workspace: ws.dir,
      groups: { g: { repos: [{ name: 'repoA', path: repoPath, remote: 'origin' }] } },
    });
  });

  it('merge without a terminal and without --yes exits non-zero and does not hang', async () => {
    const r = await runCli(ws, ['merge', 'dev', 'prod', '-r', 'repoA', '--no-fetch'], {
      timeoutMs: 15_000,
    });
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/--yes|terminal/i);
  });
});

describe('quick-start repo path resolves (C3)', () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());
  beforeEach(async () => {
    ws = await createWorkspace();
  });

  it('a repo added by relative path is found by status, even when workspace points elsewhere', async () => {
    // `gittyup init` sets the manifest workspace to the *config* dir; reproduce that by
    // pointing workspace at a sibling that does not contain the repo. The relative path
    // must still resolve (it is stored absolute, against where `repo add` ran).
    const cfg = join(ws.dir, 'cfg');
    await mkdir(cfg, { recursive: true });
    const repoPath = join(ws.dir, 'proj', 'repoB');
    await mkdir(repoPath, { recursive: true });
    git(repoPath, ['init', '-q', '-b', 'main']);
    await writeFile(join(repoPath, 'f.txt'), 'x\n');
    git(repoPath, ['add', '.']);
    git(repoPath, ['commit', '-qm', 'base']);
    await ws.writeManifest({ workspace: cfg, groups: { g: { repos: [] } } });

    const add = await runCli(ws, ['repo', 'add', 'g', 'repoB', './proj/repoB']);
    expect(add.exitCode).toBe(0);
    const status = await runCli(ws, ['status', '-g', 'g']);
    expect(`${status.stdout}${status.stderr}`).not.toMatch(/path not found|not found/i);
    expect(status.stdout).toContain('repoB');
  });
});
