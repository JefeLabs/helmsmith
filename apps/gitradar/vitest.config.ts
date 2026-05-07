import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run test files sequentially to prevent SQLITE_BUSY errors when
    // multiple test suites open the same SQLite databases concurrently.
    pool: 'forks',
    fileParallelism: false,
  },
});
