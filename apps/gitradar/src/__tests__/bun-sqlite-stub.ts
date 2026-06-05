/**
 * Stub for the `bun:sqlite` builtin, aliased in by vitest (see vitest.config.ts).
 *
 * Many vitest suites transitively import the Bun-native store (`sqlite-store.ts`)
 * without ever opening a database. Node/vitest can't resolve `bun:sqlite`, so
 * this stub stands in to satisfy the import graph. If a vitest test actually
 * tries to open a DB, the constructor throws — that test belongs under
 * `bun test` (see the `test:bun` script), not vitest.
 */
export class Database {
  constructor() {
    throw new Error(
      'bun:sqlite is stubbed under vitest. A test that opens a real database must ' +
        'run via `bun test` (see the test:bun script), not vitest.',
    );
  }
}

export default Database;
