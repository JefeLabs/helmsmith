/**
 * The Bun launcher (`bin/timetracker.mjs`) must not pick up `bunfig.toml` or `.env` from the
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
const BIN = join(APP, 'bin', 'timetracker.mjs');

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'timetracker-launcher-')));
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

describe('timetracker launcher', () => {
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

  it('does not let Bun auto-load .env files from the current directory', () => {
    // timetracker reads ./.env itself (next test), so the observable is a file only Bun's
    // auto-loader reads: .env.local.
    // Sanity: the observable is live — a real DISCORD_TOKEN removes the "token" issue.
    expect(run(sb, ['view'], { DISCORD_TOKEN: 'fake' }).out).not.toMatch(/\btoken:/);
    writeFileSync(join(sb.cwd, '.env.local'), 'DISCORD_TOKEN=fake-token-from-dotenv-local\n');
    expect(run(sb, ['view']).out).toMatch(/\btoken:/);
  }, 60_000);

  it("still reads the app's own .env through its config loader", () => {
    // timetracker reads tokens from ./.env itself (src/config/load.ts); disabling Bun's
    // auto-load must not change that.
    writeFileSync(
      join(sb.cwd, '.env'),
      'DISCORD_TOKEN=fake-token-from-dotenv\nGUILD_ID=not-a-snowflake\n',
    );
    const r = run(sb, ['view']);
    expect(r.out).toMatch(/guildId/);
    expect(r.out).not.toMatch(/\btoken:/);
  });

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

  it('reports the version from package.json, not a hard-coded one', () => {
    const { version } = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8')) as {
      version: string;
    };
    const r = run(sb, ['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(version);
  }, 60_000);
});

describe('dist bundle', () => {
  it('keeps the node: prefix on node:sqlite, which has no unprefixed form', () => {
    // tsup strips `node:` by default (removeNodeProtocol), turning the Node branch of
    // src/storage/sqlite/driver.ts into `import('sqlite')`, which Node resolves as an
    // npm package and fails on.
    const cli = readFileSync(join(APP, 'dist', 'cli.js'), 'utf8');
    expect(cli).toContain('import("node:sqlite")');
    expect(cli).not.toMatch(/import\(["']sqlite["']\)/);
  });
});
