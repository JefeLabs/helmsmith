import { defineConfig } from 'vitest/config';

// E2E: spawns the real launcher (bin/gitradar → vendored Bun → dist/cli.js).
// The global setup builds dist/ first, so these never run against stale output.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    globalSetup: ['./tests/e2e/global-setup.ts'],
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
