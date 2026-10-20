/**
 * Authors table on the real file system (#116, #111). Own `bun test` lane: see `test:bun`.
 */
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('authors commit shares (#116)', () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'gitradar-authors-'));
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

  it('round-trips commitsByRepo and subtracts a repo share in the store', async () => {
    const { loadAuthorRegistrySQL, saveAuthorRegistrySQL, subtractRepoFromAuthorCounts } =
      await import('../store/sqlite-store.js');
    saveAuthorRegistrySQL({
      version: 1,
      authors: {
        'ann@example.com': {
          email: 'ann@example.com',
          name: 'Ann',
          firstSeen: '2026-01-01',
          lastSeen: '2026-02-01',
          reposSeenIn: ['gamma', 'delta'],
          commitCount: 105,
          commitsByRepo: { gamma: 100, delta: 5 },
        },
      },
    });
    expect(loadAuthorRegistrySQL().authors['ann@example.com'].commitsByRepo).toEqual({
      gamma: 100,
      delta: 5,
    });
    subtractRepoFromAuthorCounts('gamma');
    const ann = loadAuthorRegistrySQL().authors['ann@example.com'];
    expect(ann.commitCount).toBe(5);
    expect(ann.commitsByRepo).toEqual({ delta: 5 });
  });

  it('adds the commits_by_repo column to an existing database', async () => {
    const { getSQLitePath, getDB } = await import('../store/sqlite-store.js');
    await mkdir(join(home, 'data'), { recursive: true });
    const legacy = new Database(getSQLitePath(), { create: true });
    legacy.exec(`CREATE TABLE authors (
      email TEXT PRIMARY KEY, name TEXT NOT NULL, identifier TEXT, github_handle TEXT,
      org TEXT, team TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      repos_seen_in TEXT NOT NULL DEFAULT '[]', commit_count INTEGER NOT NULL DEFAULT 0)`);
    legacy.exec(`INSERT INTO authors (email, name, first_seen, last_seen, repos_seen_in, commit_count)
      VALUES ('bob@example.com', 'Bob', '2026-01-01', '2026-01-01', '["gamma"]', 7)`);
    legacy.close();

    const db = getDB();
    const cols = (db.prepare('PRAGMA table_info(authors)').all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain('commits_by_repo');
    const { loadAuthorRegistrySQL } = await import('../store/sqlite-store.js');
    const bob = loadAuthorRegistrySQL().authors['bob@example.com'];
    expect(bob.commitCount).toBe(7);
    expect(bob.commitsByRepo).toBeUndefined();
  });
});

describe('scan lock (#111)', () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'gitradar-lock-'));
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

  it('a second acquire fails while the first holder is alive, and succeeds after release', async () => {
    const { acquireScanLock, releaseScanLock, ScanInProgressError } = await import(
      '../store/sqlite-store.js'
    );
    acquireScanLock();
    expect(() => acquireScanLock()).toThrow(ScanInProgressError);
    releaseScanLock();
    expect(() => acquireScanLock()).not.toThrow();
    releaseScanLock();
  });

  it('a lock left by a dead process is reclaimed', async () => {
    const { acquireScanLock, releaseScanLock, getDB } = await import('../store/sqlite-store.js');
    getDB()
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('scan_lock', ?)")
      .run(JSON.stringify({ pid: 2147483000, startedAt: new Date().toISOString() }));
    expect(() => acquireScanLock()).not.toThrow();
    releaseScanLock();
  });

  it('the error names the holder', async () => {
    const { acquireScanLock, releaseScanLock } = await import('../store/sqlite-store.js');
    acquireScanLock();
    expect(() => acquireScanLock()).toThrow(new RegExp(`pid ${process.pid}`));
    releaseScanLock();
  });
});

describe('scan_state reachability cursors (#79)', () => {
  let home: string;
  let savedHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'gitradar-cursor-'));
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

  it('round-trips lastTip and lastPrTip through one-row updates', async () => {
    const { loadScanStateSQL, updateRepoScanStateSQL } = await import('../store/sqlite-store.js');
    updateRepoScanStateSQL('alpha', {
      lastHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      lastScanDate: '2026-02-01T00:00:00.000Z',
      recentHashes: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
      recordCount: 1,
      lastTip: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      lastPrTip: 'cccccccccccccccccccccccccccccccccccccccc',
    });
    const alpha = loadScanStateSQL().repos.alpha;
    expect(alpha.lastTip).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(alpha.lastPrTip).toBe('cccccccccccccccccccccccccccccccccccccccc');
  });

  it('adds the tip columns to an existing database and reads them as undefined', async () => {
    const { getSQLitePath, getDB, loadScanStateSQL } = await import('../store/sqlite-store.js');
    await mkdir(join(home, 'data'), { recursive: true });
    const legacy = new Database(getSQLitePath(), { create: true });
    legacy.exec(`CREATE TABLE scan_state (repo TEXT PRIMARY KEY, last_hash TEXT NOT NULL,
      last_scan_date TEXT NOT NULL, recent_hashes TEXT NOT NULL DEFAULT '[]',
      record_count INTEGER NOT NULL DEFAULT 0, recent_pr_hashes TEXT NOT NULL DEFAULT '[]')`);
    legacy.exec(
      `INSERT INTO scan_state (repo, last_hash, last_scan_date) VALUES ('old', 'x', '2026-01-01T00:00:00.000Z')`,
    );
    legacy.close();
    getDB();
    const old = loadScanStateSQL().repos.old;
    expect(old.lastTip).toBeUndefined();
    expect(old.lastPrTip).toBeUndefined();
  });
});
