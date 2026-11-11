import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Don't pick up compiled test files in dist/ — they'd duplicate the
    // source-level tests and run against stale JS after a tsc build.
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Builds dist/ once for the tests/e2e files, which spawn the built CLI and TUI.
    globalSetup: ['./tests/e2e/global-setup.ts'],
  },
});
