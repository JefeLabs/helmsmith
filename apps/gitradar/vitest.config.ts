import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Node/vitest can't resolve the Bun builtin. Many suites only import the
      // store module graph transitively (never opening a DB), so a stub lets
      // them load; it throws if a DB is actually opened — that test belongs
      // under `bun test` (see the test:bun script).
      'bun:sqlite': fileURLToPath(new URL('./src/__tests__/bun-sqlite-stub.ts', import.meta.url)),
    },
  },
  test: {
    // Run test files sequentially to prevent SQLITE_BUSY errors when
    // multiple test suites open the same SQLite databases concurrently.
    pool: 'forks',
    fileParallelism: false,
    // These exercise the real Bun-native store (bun:sqlite) and run under
    // `bun test` instead (see the `test:bun` script). Node/vitest cannot
    // resolve the `bun:sqlite` builtin.
    exclude: [
      ...configDefaults.exclude,
      'src/__tests__/sqlite-store.test.ts',
      'src/__tests__/functional.test.ts',
    ],
  },
});
