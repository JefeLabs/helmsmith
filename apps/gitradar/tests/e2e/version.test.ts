import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(async () => {
  await sb?.cleanup();
  sb = undefined;
});

describe('gitradar --version', () => {
  it('prints the version from package.json, which changesets bumps on release', async () => {
    const pkg = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../../package.json'), 'utf8'),
    ) as { version: string };
    sb = await createSandbox();
    const r = await runCli(sb, ['--version']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });
});
