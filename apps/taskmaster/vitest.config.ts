import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/e2e/global-setup.ts'],
    // The e2e suite spawns the built CLI per assertion; on shared CI runners
    // several cases take 5-6 s and tripped vitest's 5 s default on every
    // main run since 1346641. Same bump as harness-server / harness-pipeline-cli.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
