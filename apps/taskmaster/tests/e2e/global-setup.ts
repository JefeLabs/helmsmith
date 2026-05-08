import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Vitest globalSetup: build the CLI bundle before running E2E tests.
 * Runs `npx tsup` synchronously so dist/cli.js is available.
 */
export function setup() {
  const projectRoot = resolve(import.meta.dirname, '../..');
  execFileSync('npx', ['tsup'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}
