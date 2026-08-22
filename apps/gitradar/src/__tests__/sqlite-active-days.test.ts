/**
 * Real-store tests for active-day aggregation (bun:sqlite, run via `bun test`).
 *
 * Records are stored per (member, week, repo). A person committing to three
 * repos on the same day must count that day once, not three times. These
 * tests drive the actual store module against a throwaway GITRADAR_HOME.
 */
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UserWeekRepoRecord } from '../types/schema.js';

const store = await import('../store/sqlite-store.js');

function makeRecord(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: 'Alice',
    email: 'alice@example.com',
    org: 'Acme',
    orgType: 'core',
    team: 'Frontend',
    tag: 'default',
    week: '2026-W10',
    repo: 'web',
    group: 'default',
    commits: 2,
    activeDays: 1,
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 2 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

describe('active days in the SQLite store', () => {
  let tmpHome: string;
  let dataDir: string;
  const originalOverride = process.env.GITRADAR_HOME;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'gitradar-active-days-'));
    dataDir = join(tmpHome, 'data');
    await mkdir(dataDir, { recursive: true });
    process.env.GITRADAR_HOME = tmpHome;
    // Guard: the store must resolve to the sandbox before any DB is opened.
    expect(store.getSQLitePath()).toBe(join(dataDir, 'gitradar.db'));
  });

  afterEach(async () => {
    store.closeDB();
    if (originalOverride === undefined) delete process.env.GITRADAR_HOME;
    else process.env.GITRADAR_HOME = originalOverride;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('round-trips activeDayMask through upsert and query', () => {
    store.upsertRecords([makeRecord({ activeDays: 3, activeDayMask: 0b0000111 })]);

    const [row] = store.queryRecords({});
    expect(row.activeDays).toBe(3);
    expect(row.activeDayMask).toBe(0b0000111);
  });

  it('queryRollup unions days per member-week across repos', () => {
    store.upsertRecords([
      makeRecord({ repo: 'web', activeDays: 3, activeDayMask: 0b0000111 }), // Mon Tue Wed
      makeRecord({ repo: 'api', activeDays: 2, activeDayMask: 0b0000110 }), // Tue Wed
      makeRecord({ repo: 'infra', activeDays: 1, activeDayMask: 0b0010000 }), // Fri
    ]);

    expect(store.queryRollup({}, 'member').get('Alice')!.activeDays).toBe(4);
    expect(store.queryRollup({}, 'all').get('all')!.activeDays).toBe(4);
    expect(store.queryRollup({}, 'team').get('Frontend')!.activeDays).toBe(4);

    // Per-repo grouping is unaffected — each repo's own days still show
    const byRepo = store.queryRollup({}, 'repo');
    expect(byRepo.get('web')!.activeDays).toBe(3);
    expect(byRepo.get('api')!.activeDays).toBe(2);
  });

  it('queryRollup keeps different members and weeks separate', () => {
    store.upsertRecords([
      makeRecord({ member: 'Alice', week: '2026-W10', activeDays: 2, activeDayMask: 0b11 }),
      makeRecord({ member: 'Alice', week: '2026-W11', activeDays: 2, activeDayMask: 0b11 }),
      makeRecord({ member: 'Bob', week: '2026-W10', activeDays: 2, activeDayMask: 0b11 }),
    ]);

    expect(store.queryRollup({}, 'team').get('Frontend')!.activeDays).toBe(6);
  });

  it('queryRollup falls back to summing for legacy rows without a mask', () => {
    store.upsertRecords([
      makeRecord({ repo: 'web', activeDays: 3 }),
      makeRecord({ repo: 'api', activeDays: 2 }),
    ]);

    expect(store.queryRollup({}, 'member').get('Alice')!.activeDays).toBe(5);
  });

  it('upsert merge on the same key unions masks instead of summing counts', () => {
    // First scan saw Mon+Tue; an incremental rescan of the overlap window sees Tue+Wed.
    store.upsertRecords([makeRecord({ activeDays: 2, activeDayMask: 0b011 })]);
    store.upsertRecords([makeRecord({ activeDays: 2, activeDayMask: 0b110 })]);

    const [row] = store.queryRecords({});
    expect(row.activeDayMask).toBe(0b111);
    expect(row.activeDays).toBe(3);
  });

  it('adds the active_day_mask column to a database created before it existed', () => {
    // Simulate a pre-existing DB whose records table lacks the column.
    const legacy = new Database(join(dataDir, 'gitradar.db'), { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE records (
        member TEXT NOT NULL, email TEXT NOT NULL, org TEXT NOT NULL, org_type TEXT NOT NULL,
        team TEXT NOT NULL, tag TEXT NOT NULL, week TEXT NOT NULL, repo TEXT NOT NULL, grp TEXT NOT NULL,
        commits INTEGER NOT NULL DEFAULT 0, active_days INTEGER NOT NULL DEFAULT 0,
        intent_feat INTEGER NOT NULL DEFAULT 0, intent_fix INTEGER NOT NULL DEFAULT 0,
        intent_refactor INTEGER NOT NULL DEFAULT 0, intent_docs INTEGER NOT NULL DEFAULT 0,
        intent_test INTEGER NOT NULL DEFAULT 0, intent_chore INTEGER NOT NULL DEFAULT 0,
        intent_other INTEGER NOT NULL DEFAULT 0,
        app_files INTEGER NOT NULL DEFAULT 0, app_files_added INTEGER NOT NULL DEFAULT 0,
        app_files_deleted INTEGER NOT NULL DEFAULT 0, app_ins INTEGER NOT NULL DEFAULT 0, app_del INTEGER NOT NULL DEFAULT 0,
        test_files INTEGER NOT NULL DEFAULT 0, test_files_added INTEGER NOT NULL DEFAULT 0,
        test_files_deleted INTEGER NOT NULL DEFAULT 0, test_ins INTEGER NOT NULL DEFAULT 0, test_del INTEGER NOT NULL DEFAULT 0,
        config_files INTEGER NOT NULL DEFAULT 0, config_files_added INTEGER NOT NULL DEFAULT 0,
        config_files_deleted INTEGER NOT NULL DEFAULT 0, config_ins INTEGER NOT NULL DEFAULT 0, config_del INTEGER NOT NULL DEFAULT 0,
        storybook_files INTEGER NOT NULL DEFAULT 0, storybook_files_added INTEGER NOT NULL DEFAULT 0,
        storybook_files_deleted INTEGER NOT NULL DEFAULT 0, storybook_ins INTEGER NOT NULL DEFAULT 0, storybook_del INTEGER NOT NULL DEFAULT 0,
        doc_files INTEGER NOT NULL DEFAULT 0, doc_files_added INTEGER NOT NULL DEFAULT 0,
        doc_files_deleted INTEGER NOT NULL DEFAULT 0, doc_ins INTEGER NOT NULL DEFAULT 0, doc_del INTEGER NOT NULL DEFAULT 0,
        breaking_changes INTEGER NOT NULL DEFAULT 0, scopes TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (member, week, repo)
      );
      INSERT INTO records (member, email, org, org_type, team, tag, week, repo, grp, commits, active_days)
      VALUES ('Alice', 'a@x', 'Acme', 'core', 'FE', 'default', '2026-W10', 'web', 'default', 4, 3);
    `);
    legacy.close();

    // Opening through the store must migrate and keep the legacy row readable.
    const [row] = store.queryRecords({});
    expect(row.activeDays).toBe(3);
    expect(row.activeDayMask).toBeUndefined();

    // And new writes against the migrated table carry the mask.
    store.upsertRecords([makeRecord({ repo: 'api', activeDays: 1, activeDayMask: 0b1 })]);
    expect(store.queryRecords({ repo: 'api' })[0].activeDayMask).toBe(0b1);
  });
});
