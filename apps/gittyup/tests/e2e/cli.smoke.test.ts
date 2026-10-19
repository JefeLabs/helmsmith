import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, makeRepo } from '../../src/test/git-fixture.js';
import { createWorkspace, runCli, type Workspace } from './helpers.js';

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.cleanup();
  ws = undefined;
  await cleanupFixtures();
});

describe('gittyup CLI smoke', () => {
  it('prints usage with every registered command', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['--help']);
    expect(r.exitCode).toBe(0);
    for (const cmd of [
      'init',
      'repo',
      'find',
      'group',
      'status',
      'fetch',
      'compare',
      'merge',
      'pick',
      'prs',
      'cache',
      'auth',
      'config',
      'connect',
    ]) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it("does not read the developer's home config", async () => {
    ws = await createWorkspace();
    const dir = ws.dir;
    expect(() =>
      execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' }),
    ).toThrow();
    const r = await runCli(ws, ['repo', 'list']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('No repos configured');
    expect(r.stdout).toContain(`config: ${ws.manifestPath}`);
  });

  it('shows a fixture repo on the status dashboard', async () => {
    const repo = await makeRepo({
      commits: [
        { message: 'base', files: { 'f.txt': 'x\n' } },
        { branch: 'develop', message: 'dev', files: { 'f.txt': 'y\n' } },
      ],
    });
    ws = await createWorkspace({
      workspace: '.',
      groups: {
        app: {
          repos: [{ name: 'fixture', path: repo.path, branches: { dev: 'develop', prod: 'main' } }],
        },
      },
    });
    const r = await runCli(ws, ['status', '--compact']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('fixture');
    expect(r.stdout).toContain('All clean');
  });

  it('config --show reports no GitHub token in an isolated home', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['config', '--show']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('not found');
  });
});

/** Number of live `gittyup/dist/cli.js` processes (Bun re-execs); 0 when pgrep finds none. */
function countCliProcesses(): number {
  try {
    const out = execFileSync('pgrep', ['-f', 'gittyup/dist/cli.js'], { stdio: 'pipe' }).toString();
    return out.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

describe('runCli process hygiene', () => {
  it('lets an interactive prompt fail fast on stdin EOF instead of waiting for the timeout', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    ws = await createWorkspace({
      workspace: '.',
      groups: { app: { repos: [{ name: 'fixture', path: repo.path }] } },
    });
    const started = Date.now();
    const r = await runCli(ws, ['repo', 'tag'], { timeoutMs: 15_000 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.timedOut).toBe(false);
  });

  it('kills the whole process group on timeout and reports it', async () => {
    const repo = await makeRepo({ commits: [{ message: 'base', files: { 'f.txt': 'x\n' } }] });
    ws = await createWorkspace({
      workspace: '.',
      groups: { app: { repos: [{ name: 'fixture', path: repo.path }] } },
    });
    const before = countCliProcesses();
    const r = await runCli(ws, ['repo', 'tag'], { timeoutMs: 1_500, keepStdinOpen: true });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
    await new Promise((res) => setTimeout(res, 300));
    const after = countCliProcesses();
    expect(after).toBe(before);
  });
});
