import { defineConfig } from 'vitest/config';

// E2E: spawns the built CLI (bin/gittyup.mjs → dist/cli.js). The global
// setup builds dist/ first, so these never run against stale output.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['./tests/e2e/global-setup.ts'],
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
