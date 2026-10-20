/**
 * `getDB` and `--reset` on the real file system (#96). Own file: `functional.test.ts`
 * mocks `../store/paths.js` for the rest of its process, so this must run in its own
 * `bun test` invocation (see `test:bun` in package.json).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('getDB / resetAllData (#96)', () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'gitradar-reset-'));
    savedHome = process.env.GITRADAR_HOME;
    process.env.GITRADAR_HOME = home;
  });

  afterEach(async () => {
    const { resetDB } = await import('../store/sqlite-store.js');
    resetDB();
    if (savedHome === undefined) delete process.env.GITRADAR_HOME;
    else process.env.GITRADAR_HOME = savedHome;
    await rm(home, { recursive: true, force: true });
  });

  it('getDB creates the data directory on a fresh install', async () => {
    const { getDB, getSQLitePath } = await import('../store/sqlite-store.js');
    expect(existsSync(join(home, 'data'))).toBe(false);
    getDB();
    expect(existsSync(getSQLitePath())).toBe(true);
  });

  it('getDB reports a corrupt file as corrupt and points at --reset', async () => {
    const { getDB, getSQLitePath } = await import('../store/sqlite-store.js');
    await mkdir(join(home, 'data'), { recursive: true });
    await writeFile(getSQLitePath(), 'this is not a database\n');
    expect(() => getDB()).toThrow(/corrupt/i);
    expect(() => getDB()).toThrow(/--reset/);
  });

  it('listDataFiles and resetAllData move db, wal and shm aside without opening them', async () => {
    const { getSQLitePath, listDataFiles, resetAllData } = await import('../store/sqlite-store.js');
    const dbPath = getSQLitePath();
    expect(listDataFiles()).toEqual([]);
    expect(resetAllData()).toEqual([]);

    await mkdir(join(home, 'data'), { recursive: true });
    await writeFile(dbPath, 'garbage');
    await writeFile(`${dbPath}-wal`, 'garbage');
    expect(listDataFiles()).toEqual([dbPath, `${dbPath}-wal`]);

    const moved = resetAllData();
    expect(moved).toHaveLength(2);
    expect(moved[0]).toMatch(/gitradar\.db\.bak-\d{8}T\d{6}Z$/);
    expect(moved[1]).toMatch(/gitradar\.db-wal\.bak-\d{8}T\d{6}Z$/);
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(readFileSync(moved[0], 'utf-8')).toBe('garbage');
    expect(listDataFiles()).toEqual([]);
  });
});
