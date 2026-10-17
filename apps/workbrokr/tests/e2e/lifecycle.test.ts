import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitIn, makeRepo } from '@helmsmith/workkit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ROOT, makeHome, runCli } from './helpers.js';

const FIXTURE = join(APP_ROOT, 'tests', 'e2e', 'fixtures', 'project');

async function reachable(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

describe('lifecycle through the bin', () => {
  const { home, cleanup: cleanHome } = makeHome();
  let repo: ReturnType<typeof makeRepo>;
  const env = { WORK_SESSION: 's1' };
  let worktree = '';
  let backendPort = 0;

  beforeAll(() => {
    repo = makeRepo();
    cpSync(FIXTURE, repo.main, { recursive: true });
    gitIn(repo.main, 'add', '-A');
    gitIn(repo.main, 'commit', '-q', '-m', 'fixture project');
    gitIn(repo.main, 'push', '-q', 'origin', 'develop');
  });
  afterAll(async () => {
    await runCli(['finish', '--area', 'shop/cart', '--project-root', repo.main], {
      home,
      env,
    }).catch(() => undefined);
    cleanHome();
    repo.cleanup();
  });

  it('start leases a slot, writes config, brings the services up', async () => {
    const r = await runCli(
      [
        'start',
        '--area',
        'shop/cart',
        '--type',
        'feature',
        '--mode',
        'fullstack',
        '--project-root',
        repo.main,
        '--json',
      ],
      { home, cwd: repo.main, env, timeoutMs: 90_000 },
    );
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      effort: { worktree: string; branch: string };
      leases: { kind: string; value: number; ports: Record<string, number> }[];
      refreshed: string[];
    };
    worktree = out.effort.worktree;
    expect(out.effort.branch).toBe('feature/shop/cart');
    expect(out.leases[0].kind).toBe('slot');
    expect(out.leases[0].value).toBe(1);
    backendPort = out.leases[0].ports.backend;
    expect(backendPort).toBe(45101);
    expect(readFileSync(join(worktree, '.env.slot'), 'utf8')).toContain('PORT_BACKEND=45101');
    expect(readFileSync(join(worktree, '.logs', 'refresh.marker'), 'utf8')).toContain('refreshed');
    expect(await reachable(backendPort)).toBe(true);
  });

  it('status lists the effort; a second session is refused and told who holds it', async () => {
    const s = await runCli(['status', '--project-root', repo.main, '--json'], { home, env });
    expect(s.code).toBe(0);
    const status = JSON.parse(s.stdout) as {
      areas: { area: string; effort?: { owner: { session: string } } }[];
    };
    expect(status.areas.find((a) => a.area === 'shop/cart')?.effort?.owner.session).toBe('s1');
    const again = await runCli(
      [
        'start',
        '--area',
        'shop/cart',
        '--type',
        'fix',
        '--mode',
        'frontend',
        '--project-root',
        repo.main,
      ],
      { home, env: { WORK_SESSION: 'other' } },
    );
    expect(again.code).toBe(2);
    expect(again.stderr).toMatch(/EFFORT_OPEN/);
    expect(again.stderr).toMatch(/s1/);
    const envOut = await runCli(['env', '--area', 'shop/cart', '--project-root', repo.main], {
      home,
      env,
    });
    expect(envOut.stdout).toContain('PORT_BACKEND=45101');
    expect(envOut.stdout).toContain('MODE=fullstack');
  });

  it('finish stops the services, releases the slot, pushes the branch', async () => {
    const r = await runCli(
      ['finish', '--area', 'shop/cart', '--project-root', repo.main, '--json'],
      { home, env },
    );
    expect(r.code, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout) as { pushed: boolean }).pushed).toBe(true);
    expect(await reachable(backendPort)).toBe(false);
    expect(gitIn(repo.main, 'ls-remote', '--heads', 'origin', 'feature/shop/cart').trim()).not.toBe(
      '',
    );
    const s = JSON.parse(
      (await runCli(['status', '--project-root', repo.main, '--json'], { home, env })).stdout,
    ) as { leases: unknown[] };
    expect(s.leases).toEqual([]);
  });

  it('retire removes the worktree; audit has nothing to say', async () => {
    const r = await runCli(
      ['retire', '--area', 'shop/cart', '--project-root', repo.main, '--json'],
      { home, env },
    );
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    const a = await runCli(['audit', '--project-root', repo.main, '--json'], { home, env });
    expect(a.code).toBe(0);
    expect(JSON.parse(a.stdout)).toEqual([]);
  });
});
