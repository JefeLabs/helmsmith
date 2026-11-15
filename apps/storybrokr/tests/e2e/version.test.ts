import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_ROOT, makeHome, runCli } from './helpers.js';

describe('storybrokr --version', () => {
  const { home, cleanup } = makeHome();
  afterAll(cleanup);

  it('prints the package version and exits 0', async () => {
    const r = await runCli(['--version'], { home });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('story, the short name', () => {
  const { home, cleanup } = makeHome();
  afterAll(cleanup);
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
    version: string;
    bin: Record<string, string>;
  };

  it('is a bin of the package beside storybrokr', () => {
    expect(Object.keys(pkg.bin).sort()).toEqual(['story', 'storybrokr']);
  });

  it('runs the same CLI: same version, same commands', async () => {
    const bin = join(APP_ROOT, pkg.bin.story ?? 'missing');
    const version = await runCli(['--version'], { home, bin });
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);

    const help = await runCli(['--help'], { home, bin });
    const longHelp = await runCli(['--help'], { home });
    expect(help.stdout).toBe(longHelp.stdout);
  });
});
