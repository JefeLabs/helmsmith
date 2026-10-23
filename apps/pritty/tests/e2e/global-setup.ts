import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Vitest globalSetup: build the CLI bundle before running E2E tests so
 * bin/pritty.mjs resolves a fresh dist/cli.js.
 */
export function setup(): void {
  const projectRoot = resolve(import.meta.dirname, '../..');
  execFileSync('pnpm', ['exec', 'tsup'], { cwd: projectRoot, stdio: 'inherit' });
}
