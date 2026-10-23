import { defineConfig } from 'vitest/config';

// Unit tests only: co-located `src/**/*.test.ts`. E2E lives under tests/e2e
// and runs through vitest.e2e.config.ts (`pnpm test:e2e`).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
