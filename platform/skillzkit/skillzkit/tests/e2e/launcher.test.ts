/**
 * The Bun launcher (`bin/skillzkit.mjs`) must not pick up `bunfig.toml` or `.env` from the
 * current directory. Bun auto-loads both from the cwd and a `bunfig.toml` `preload` runs
 * arbitrary code, so running this CLI inside a cloned repo could execute that repo's code
 * (same class as helmsmith#69). These tests spawn the real launcher from a hostile cwd.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const APP = resolve(import.meta.dirname, '../..');
const BIN = join(APP, 'bin', 'skillzkit.mjs');

// Build the real bundle the launcher spawns (`dist/cli.js`), so this never runs stale output.
beforeAll(() => {
  execFileSync('pnpm', ['exec', 'tsup'], { cwd: APP, stdio: 'pipe' });
}, 120_000);

interface Sandbox {
  root: string;
  home: string;
  cwd: string;
}

let sb: Sandbox;
beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skillzkit-launcher-')));
  sb = { root, home: join(root, 'home'), cwd: join(root, 'cwd') };
  mkdirSync(sb.home);
  mkdirSync(sb.cwd);
});
afterEach(() => {
  rmSync(sb.root, { recursive: true, force: true });
});

/** Spawn the launcher with a minimal env: sandbox HOME, no git config, stdin closed. */
function run(s: Sandbox, args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: s.cwd,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: s.home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      ...extraEnv,
    },
    encoding: 'utf8',
    input: '',
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, out: `${r.stdout}${r.stderr}` };
}

describe('skillzkit launcher', () => {
  it('does not run a bunfig.toml preload from the current directory', () => {
    const marker = join(sb.root, 'PWNED');
    writeFileSync(join(sb.cwd, 'bunfig.toml'), 'preload = ["./evil.ts"]\n');
    writeFileSync(
      join(sb.cwd, 'evil.ts'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'preload ran');\n`,
    );
    const r = run(sb, ['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(existsSync(marker)).toBe(false);
  }, 60_000);

  it('does not load a .env from the current directory', () => {
    // A planted config reached through SKILLZKIT_CONFIG is the observable.
    const planted = join(sb.root, 'planted-config.json');
    writeFileSync(
      planted,
      JSON.stringify({
        version: 1,
        mode: 'standalone',
        email: 'planted@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    // Sanity: the observable is live — as a real variable it selects the planted config.
    expect(run(sb, ['config'], { SKILLZKIT_CONFIG: planted }).out).toContain('planted@example.com');
    writeFileSync(join(sb.cwd, '.env'), `SKILLZKIT_CONFIG=${planted}\n`);
    expect(run(sb, ['config']).out).not.toContain('planted@example.com');
  }, 60_000);

  it('reports the version from package.json, not a hard-coded one', () => {
    const { version } = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as {
      version: string;
    };
    const r = run(sb, ['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(version);
  }, 60_000);

  it('fails closed instead of running a `bun` found on PATH when the vendored Bun is missing', () => {
    // A bare `bun` is looked up through PATH, and on Windows in the current directory first,
    // so a cloned repo could plant one. Copy the launcher where no node_modules sits above
    // it, so require.resolve('bun/package.json') fails, and put a fake `bun` first on PATH.
    mkdirSync(join(sb.root, 'bin'));
    mkdirSync(join(sb.root, 'fakebin'));
    const launcher = join(sb.root, 'bin', 'launcher.mjs');
    copyFileSync(BIN, launcher);
    const marker = join(sb.root, 'PLANTED_BUN_RAN');
    const fakeBun = join(sb.root, 'fakebin', 'bun');
    writeFileSync(fakeBun, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
    chmodSync(fakeBun, 0o755);
    const r = spawnSync(process.execPath, [launcher, '--version'], {
      cwd: sb.cwd,
      env: { HOME: sb.home, PATH: `${join(sb.root, 'fakebin')}:/usr/bin:/bin` },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(existsSync(marker)).toBe(false);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/vendored Bun/);
  }, 60_000);
});
