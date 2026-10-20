import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

/**
 * Vitest setup file: every test file runs with HOME and GITRADAR_HOME pointed
 * at a throwaway directory, so no test can write into the developer's real
 * ~/.agentx by omission (#74). Tests that need "no override" delete
 * GITRADAR_HOME themselves; HOME stays sandboxed either way.
 */
const home = mkdtempSync(join(tmpdir(), 'gitradar-unit-'));
process.env.HOME = home;
process.env.GITRADAR_HOME = join(home, 'gitradar');
mkdirSync(process.env.GITRADAR_HOME, { recursive: true });

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});
