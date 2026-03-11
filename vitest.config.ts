import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use forks pool with singleFork to run test files sequentially.
    // This prevents SQLITE_BUSY errors when multiple test suites
    // open the same (or temp-dir-based) SQLite databases concurrently.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
