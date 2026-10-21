/**
 * `gittyup fetch` must exit non-zero when a repo's fetch fails, not just print a warning
 * (G5/C2/C8). Drives the real CLI against a repo whose remote does not exist.
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

describe('fetch exit code', () => {
  let ws: Workspace;
  afterEach(() => ws?.cleanup());
  beforeEach(async () => {
    ws = await createWorkspace();
    const repoPath = join(ws.dir, 'repoA');
    await mkdir(repoPath, { recursive: true });
    git(repoPath, ['init', '-q', '-b', 'main']);
    await writeFile(join(repoPath, 'f.txt'), 'x\n');
    git(repoPath, ['add', '.']);
    git(repoPath, ['commit', '-qm', 'base']);
    // No remote named 'origin' exists → `git fetch origin` fails.
    await ws.writeManifest({
      workspace: ws.dir,
      groups: { g: { repos: [{ name: 'repoA', path: repoPath, remote: 'origin' }] } },
    });
  });

  it('exits non-zero and says a repo failed', async () => {
    const r = await runCli(ws, ['fetch', '-g', 'g']);
    expect(r.exitCode).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/failed/i);
  });
});
