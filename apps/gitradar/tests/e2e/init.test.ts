import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(async () => {
  await sb?.cleanup();
  sb = undefined;
});

describe('gitradar init', () => {
  it('creates the config and the repos registry on a fresh machine', async () => {
    sb = await createSandbox();
    const r = await runCli(sb, ['init']);
    expect(r.stderr).toBe('');
    expect(r.exitCode).toBe(0);
    await expect(access(join(sb.gitradarHome, 'config.yml'))).resolves.toBeUndefined();
    await expect(access(join(sb.home, '.agentx', 'repos.yml'))).resolves.toBeUndefined();
    expect(r.stdout).toContain('Initialized');
  });

  it('is idempotent: a second run reports nothing to do and exits 0', async () => {
    sb = await createSandbox();
    expect((await runCli(sb, ['init'])).exitCode).toBe(0);
    const r = await runCli(sb, ['init']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Already initialized');
  });
});
