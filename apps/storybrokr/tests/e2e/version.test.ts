import { afterAll, describe, expect, it } from 'vitest';
import { makeHome, runCli } from './helpers.js';

describe('storybrokr --version', () => {
  const { home, cleanup } = makeHome();
  afterAll(cleanup);

  it('prints the package version and exits 0', async () => {
    const r = await runCli(['--version'], { home });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
