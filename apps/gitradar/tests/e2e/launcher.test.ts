import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

describe('bin/gitradar launcher hardening (#69)', () => {
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
    expect(await exists(join(sb.home, '.agentx', 'gitradar', 'config.yml'))).toBe(true);
  });
});
