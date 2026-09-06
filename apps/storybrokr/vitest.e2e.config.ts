// vitest.e2e.config.ts — subprocess tests; requires `tsup` to have run
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['dist/**', 'tests/e2e/fixtures/**'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
