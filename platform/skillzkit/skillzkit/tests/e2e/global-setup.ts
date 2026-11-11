import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Vitest globalSetup: build the bundles the e2e tests spawn (dist/cli.js through
 * bin/skillzkit.mjs, and dist/tui.js through `skillzkit ui`) once, before any test file runs,
 * so they never run stale output. Building inside each file raced: vitest runs files in
 * parallel, and tsup's `clean: true` empties dist/ while another file may be spawning from it.
 */
export function setup(): void {
  execFileSync('pnpm', ['exec', 'tsup'], {
    cwd: resolve(import.meta.dirname, '../..'),
    stdio: 'pipe',
  });
}
