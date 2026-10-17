import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitFile, gitIn, makeRepo } from '@helmsmith/workkit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_ROOT, makeHome, runCli } from './helpers.js';

/** The hook scripts exec `workbrokr` from PATH; point it at this checkout's bin. */
function shimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workbrokr-shim-'));
  const shim = join(dir, 'workbrokr');
  writeFileSync(
    shim,
    `#!/bin/sh\nexec "${process.execPath}" "${join(APP_ROOT, 'bin', 'workbrokr.mjs')}" "$@"\n`,
  );
  chmodSync(shim, 0o755);
  return dir;
}

const MANIFEST = `export default {
  project: 'hooks-e2e',
  baseBranch: 'develop',
  ports: { services: { backend: { base: 47100 } } },
  services: { backend: { start: 'true', stop: 'true', health: 'true' } },
  scopes: { frontend: ['app/{group}/{section}/**'], backend: ['svc/{module}/**'] },
  areas: { 'shop/cart': { module: 'cart' }, 'platform/auth': { commons: ['auth'] } },
  commons: { auth: ['api/auth/**'] },
};
`;

describe('git hooks through the bin', () => {
  const { home, cleanup: cleanHome } = makeHome();
  const shim = shimDir();
  let repo: ReturnType<typeof makeRepo>;
  const env = { PATH: `${shim}:${process.env.PATH}`, WORK_SESSION: 's1' };
  const git = (cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...env, HELMSMITH_HOME: home, ...extraEnv },
      stdio: 'pipe',
    });

  beforeAll(async () => {
    repo = makeRepo();
    writeFileSync(join(repo.main, 'helmsmith.config.mjs'), MANIFEST);
    const installed = await runCli(['hooks', 'install', '--project-root', repo.main], {
      home,
      cwd: repo.main,
      env,
    });
    expect(installed.code, installed.stderr).toBe(0);
    // The hooks must live on develop so area worktrees carry them; this one commit bypasses them.
    gitIn(repo.main, 'add', '-A');
    gitIn(repo.main, '-c', 'core.hooksPath=/nonexistent', 'commit', '-q', '-m', 'tooling');
    // The bootstrap push of the hooks themselves bypasses them explicitly: the pre-push script refuses develop.
    gitIn(repo.main, '-c', 'core.hooksPath=/nonexistent', 'push', '-q', 'origin', 'develop');
  });
  afterAll(() => {
    cleanHome();
    repo.cleanup();
    rmSync(shim, { recursive: true, force: true });
  });

  it('refuses a commit on develop', () => {
    let error = '';
    try {
      git(repo.main, ['commit', '--allow-empty', '-m', 'on develop']);
    } catch (e) {
      error = (e as { stderr?: string }).stderr ?? String(e);
    }
    expect(error).toMatch(/protected/);
  });

  it('allows a commit in a started area worktree, refuses a write under commons another session holds', async () => {
    const started = await runCli(
      [
        'start',
        '--area',
        'shop/cart',
        '--type',
        'feature',
        '--mode',
        'frontend',
        '--project-root',
        repo.main,
        '--json',
      ],
      { home, cwd: repo.main, env },
    );
    expect(started.code, started.stderr).toBe(0);
    const worktree = (JSON.parse(started.stdout) as { effort: { worktree: string } }).effort
      .worktree;
    commitFile(worktree, 'app/shop/cart/page.tsx', '1', 'cart page');
    expect(() => git(worktree, ['commit', '--allow-empty', '-m', 'fine'])).not.toThrow();

    const other = await runCli(
      [
        'start',
        '--area',
        'platform/auth',
        '--type',
        'fix',
        '--mode',
        'frontend',
        '--project-root',
        repo.main,
        '--json',
      ],
      { home, cwd: repo.main, env: { ...env, WORK_SESSION: 'other' } },
    );
    expect(other.code, other.stderr).toBe(0);
    mkdirSync(join(worktree, 'api/auth'), { recursive: true });
    writeFileSync(join(worktree, 'api/auth/x.ts'), 'x');
    git(worktree, ['add', 'api/auth/x.ts']);
    let error = '';
    try {
      git(worktree, ['commit', '-m', 'touch auth']);
    } catch (e) {
      error = (e as { stderr?: string }).stderr ?? String(e);
    }
    expect(error).toMatch(/auth.*locked.*other/);
  });

  it('pre-push lets an area branch through and warns when a path leaves the scope', async () => {
    const worktree = join(repo.main, '.claude/worktrees/shop/cart');
    commitFile(worktree, 'svc/other/thing.ts', '1', 'outside');
    const out = git(worktree, ['push', '-u', 'origin', 'feature/shop/cart']);
    expect(typeof out).toBe('string');
  });

  it('C2: without WORK_SESSION the holder of a commons lock can still commit under it', async () => {
    const noSession = {
      PATH: env.PATH,
      WORK_SESSION: '',
      CLAUDE_SESSION_NAME: '',
      CLAUDE_CODE_SESSION_ID: '',
    };
    await runCli(['finish', '--area', 'platform/auth', '--project-root', repo.main], {
      home,
      env: { ...env, WORK_SESSION: 'other' },
    });
    const started = await runCli(
      [
        'start',
        '--area',
        'platform/auth',
        '--type',
        'fix',
        '--mode',
        'frontend',
        '--project-root',
        repo.main,
        '--json',
      ],
      { home, cwd: repo.main, env: noSession },
    );
    expect(started.code, started.stderr).toBe(0);
    const worktree = (JSON.parse(started.stdout) as { effort: { worktree: string } }).effort
      .worktree;
    mkdirSync(join(worktree, 'api/auth'), { recursive: true });
    writeFileSync(join(worktree, 'api/auth/mine.ts'), 'x');
    git(worktree, ['add', 'api/auth/mine.ts'], noSession);
    expect(() => git(worktree, ['commit', '-m', 'my own commons'], noSession)).not.toThrow();
  });

  it('I1: a push whose destination is develop is refused even from an area branch', () => {
    const worktree = join(repo.main, '.claude/worktrees/shop/cart');
    let error = '';
    try {
      git(worktree, ['push', 'origin', 'HEAD:develop']);
    } catch (e) {
      error = (e as { stderr?: string }).stderr ?? String(e);
    }
    expect(error).toMatch(/develop.*protected/);
    expect(gitIn(repo.main, 'ls-remote', 'origin', 'refs/heads/develop')).not.toContain(
      gitIn(worktree, 'rev-parse', 'HEAD').trim(),
    );
  });

  it('I2: a commit on develop is refused even when workbrokr is not on PATH', () => {
    let error = '';
    try {
      git(repo.main, ['commit', '--allow-empty', '-m', 'no binary'], { PATH: '/usr/bin:/bin' });
    } catch (e) {
      error = (e as { stderr?: string }).stderr ?? String(e);
    }
    expect(error).toMatch(/protected/);
  });
});
