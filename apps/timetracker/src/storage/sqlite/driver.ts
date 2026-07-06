/**
 * Runtime-portable SQLite driver shim.
 *
 * Node and Bun ship mutually-exclusive built-in SQLite modules: Node has
 * `node:sqlite` (DatabaseSync), Bun has `bun:sqlite` (Database). Neither
 * implements the other's module. Production runs on Bun; the vitest suite
 * runs on Node — so the SqliteAdapter talks to THIS shim, which picks the
 * right engine at runtime and exposes the small subset both share.
 *
 * Portability rule: only positional `?` placeholders, bound by argument order
 * via run/get/all(...args). That's the one binding style identical across
 * both drivers (no `?1` reuse, no named params).
 */

export type SqlValue = string | number | null;

export interface SqliteStatement {
  run(...args: SqlValue[]): void;
  get(...args: SqlValue[]): Record<string, unknown> | undefined;
  all(...args: SqlValue[]): Record<string, unknown>[];
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

export async function openSqlite(path: string): Promise<SqliteDb> {
  if (isBun) {
    const { Database } = await import('bun:sqlite');
    const db = new Database(path);
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => {
        const stmt = db.prepare(sql);
        return {
          run: (...args) => {
            stmt.run(...(args as never[]));
          },
          get: (...args) =>
            (stmt.get(...(args as never[])) as Record<string, unknown>) ?? undefined,
          all: (...args) => stmt.all(...(args as never[])) as Record<string, unknown>[],
        };
      },
      close: () => db.close(),
    };
  }

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        run: (...args) => {
          stmt.run(...args);
        },
        get: (...args) => (stmt.get(...args) as Record<string, unknown>) ?? undefined,
        all: (...args) => stmt.all(...args) as Record<string, unknown>[],
      };
    },
    close: () => db.close(),
  };
}
