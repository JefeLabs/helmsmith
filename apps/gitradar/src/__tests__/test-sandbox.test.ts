import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { getCacheDir, getConfigDir } from '../store/paths.js';

/**
 * Every unit-test file must run with HOME and GITRADAR_HOME pointed at a
 * throwaway directory, so no test can write into the developer's real
 * ~/.agentx by omission (#74). The vitest setup file provides this.
 */
describe('unit-test sandbox', () => {
  const tmp = realpathSync(tmpdir());

  it('points GITRADAR_HOME at a temp directory', () => {
    expect(process.env.GITRADAR_HOME).toBeDefined();
    expect(realpathSync(process.env.GITRADAR_HOME as string).startsWith(tmp)).toBe(true);
    expect(getConfigDir()).toBe(process.env.GITRADAR_HOME);
    expect(getCacheDir().startsWith(process.env.GITRADAR_HOME as string)).toBe(true);
  });

  it('points HOME at a temp directory', () => {
    expect(process.env.HOME).toBeDefined();
    expect(realpathSync(process.env.HOME as string).startsWith(tmp)).toBe(true);
  });
});
