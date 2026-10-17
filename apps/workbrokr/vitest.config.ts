// vitest.config.ts — unit + integration only
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'tests/**'],
    testTimeout: 15_000,
  },
});
