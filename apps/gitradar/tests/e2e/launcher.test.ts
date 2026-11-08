import { spawnSync } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(async () => {
  await sb?.cleanup();
  sb = undefined;
});

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

describe('bin/gitradar.mjs launcher hardening (#69)', () => {
  it('does not run a bunfig.toml preload from the current directory', async () => {
    sb = await createSandbox();
    const cwd = await sb.mkdir('hostile-bunfig');
    const marker = join(cwd, 'PRELOAD_RAN');
    await writeFile(join(cwd, 'bunfig.toml'), 'preload = ["./p.js"]\n');
    await writeFile(
      join(cwd, 'p.js'),
      `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");\n`,
    );
    const r = await runCli(sb, ['--version'], { cwd });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await exists(marker)).toBe(false);
  });

  it('does not load a .env from the current directory into the process environment', async () => {
    sb = await createSandbox();
    const cwd = await sb.mkdir('hostile-env');
    const evilHome = await sb.mkdir('evil-gitradar-home');
    await writeFile(join(cwd, '.env'), `GITRADAR_HOME=${evilHome}\n`);
    // GITRADAR_HOME deliberately unset: Bun only injects variables that are not
    // already set, which is exactly the case for a user who never exports it.
    const r = await runCli(sb, ['init'], { cwd, env: { GITRADAR_HOME: undefined } });
    expect(r.exitCode).toBe(0);
    expect(await exists(join(evilHome, 'config.yml'))).toBe(false);
    expect(await exists(join(sb.home, '.helmsmith', 'gitradar', 'config.yml'))).toBe(true);
  });

  it('fails closed instead of running a `bun` found on PATH when the vendored Bun is missing', async () => {
    // A bare `bun` is looked up through PATH, and on Windows in the current directory
    // first, so a cloned repo could plant one. The launcher must only run the vendored
    // binary it resolves by absolute path.
    const iso = await realpath(await mkdtemp(join(tmpdir(), 'gitradar-launcher-')));
    try {
      await mkdir(join(iso, 'bin'));
      await mkdir(join(iso, 'fakebin'));
      const launcher = join(iso, 'bin', 'gitradar.mjs');
      await copyFile(resolve(import.meta.dirname, '../../bin/gitradar.mjs'), launcher);
      const marker = join(iso, 'PLANTED_BUN_RAN');
      const fakeBun = join(iso, 'fakebin', 'bun');
      await writeFile(fakeBun, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
      await chmod(fakeBun, 0o755);
      // No node_modules above `iso`, so require.resolve('bun/package.json') fails.
      const r = spawnSync(process.execPath, [launcher, '--version'], {
        cwd: iso,
        env: { HOME: iso, PATH: `${join(iso, 'fakebin')}:/usr/bin:/bin` },
        encoding: 'utf8',
      });
      expect(await exists(marker)).toBe(false);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/vendored Bun/);
    } finally {
      await rm(iso, { recursive: true, force: true });
    }
  });
});
