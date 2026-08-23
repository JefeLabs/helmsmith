/** Real-store tests for PR-proxy / rework columns (bun:sqlite, sandboxed via GITRADAR_HOME). */
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
    scopes: [],
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

/** All-zero filetype block — the shape a post-pass "holder" record carries. */
function zeroFiletype(): UserWeekRepoRecord['filetype'] {
  return {
    app: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
  };
}

/** A record with `n` app insertions and one commit, in the given week. */
function linesRecord(member: string, insertions: number, week: string): UserWeekRepoRecord {
  return makeRecord({
    member,
    email: `${member}@example.com`,
    week,
    commits: 1,
    filetype: {
      ...zeroFiletype(),
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions, deletions: 0 },
    },
  });
}

describe('scorecard columns in the SQLite store', () => {
  let tmpHome: string;
  let dataDir: string;
  const originalOverride = process.env.GITRADAR_HOME;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'gitradar-scorecard-'));
    dataDir = join(tmpHome, 'data');
    await mkdir(dataDir, { recursive: true });
    process.env.GITRADAR_HOME = tmpHome;
    expect(store.getSQLitePath()).toBe(join(dataDir, 'gitradar.db'));
  });

  afterEach(async () => {
    store.closeDB();
    if (originalOverride === undefined) delete process.env.GITRADAR_HOME;
    else process.env.GITRADAR_HOME = originalOverride;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('round-trips the four new fields', () => {
    store.upsertRecords([
      makeRecord({ prsMergedGit: 2, prSizes: [120, 40], reworkLines: 7, reworkSelfLines: 3 }),
    ]);
    const [row] = store.queryRecords({});
    expect(row.prsMergedGit).toBe(2);
    expect(row.prSizes).toEqual([120, 40]);
    expect(row.reworkLines).toBe(7);
    expect(row.reworkSelfLines).toBe(3);
  });

  it('reads legacy rows as zero/empty for the new fields', () => {
    store.upsertRecords([makeRecord()]);
    const [row] = store.queryRecords({});
    expect(row.prsMergedGit).toBe(0);
    expect(row.prSizes).toEqual([]);
    expect(row.reworkLines).toBe(0);
  });

  it('upsert merge adds counters, concatenates pr_sizes and unions scopes', () => {
    store.upsertRecords([
      makeRecord({
        prsMergedGit: 1,
        prSizes: [100],
        reworkLines: 2,
        reworkSelfLines: 1,
        scopes: ['auth'],
      }),
    ]);
    store.upsertRecords([
      makeRecord({
        commits: 0,
        prsMergedGit: 2,
        prSizes: [30, 70],
        reworkLines: 5,
        reworkSelfLines: 0,
        scopes: ['api', 'auth'],
      }),
    ]);
    const [row] = store.queryRecords({});
    expect(row.commits).toBe(2);
    expect(row.prsMergedGit).toBe(3);
    expect(row.prSizes).toEqual([100, 30, 70]);
    expect(row.reworkLines).toBe(7);
    expect(row.reworkSelfLines).toBe(1);
    expect([...(row.scopes ?? [])].sort()).toEqual(['api', 'auth']);
  });

  it('queryRollup sums counters and concatenates pr_sizes per group', () => {
    store.upsertRecords([
      makeRecord({
        repo: 'web',
        prsMergedGit: 1,
        prSizes: [100],
        reworkLines: 2,
        reworkSelfLines: 1,
      }),
      makeRecord({
        repo: 'api',
        prsMergedGit: 2,
        prSizes: [30, 70],
        reworkLines: 5,
        reworkSelfLines: 2,
      }),
      makeRecord({ member: 'Bob', repo: 'api', prsMergedGit: 1, prSizes: [9] }),
    ]);
    const alice = store.queryRollup({}, 'member').get('Alice')!;
    expect(alice.prsMergedGit).toBe(3);
    expect([...alice.prSizes].sort((a, b) => a - b)).toEqual([30, 70, 100]);
    expect(alice.reworkLines).toBe(7);
    expect(alice.reworkSelfLines).toBe(3);
    const all = store.queryRollup({}, 'all').get('all')!;
    expect(all.prsMergedGit).toBe(4);
    expect(all.prSizes).toHaveLength(4);
  });

  it('round-trips recentPrHashes through scan state', () => {
    store.saveScanStateSQL({
      version: 1,
      repos: {
        web: {
          lastHash: 'a',
          lastScanDate: '2026-03-01T00:00:00Z',
          recentHashes: ['a'],
          recordCount: 1,
          recentPrHashes: ['m1'],
        },
      },
    });
    expect(store.loadScanStateSQL().repos.web.recentPrHashes).toEqual(['m1']);
    store.updateRepoScanStateSQL('web', {
      lastHash: 'b',
      lastScanDate: '2026-03-02T00:00:00Z',
      recentHashes: ['b', 'a'],
      recordCount: 2,
      recentPrHashes: ['m2', 'm1'],
    });
    expect(store.loadScanStateSQL().repos.web.recentPrHashes).toEqual(['m2', 'm1']);
  });

  it('migrates a pre-existing database that lacks the new columns', () => {
    const legacy = new Database(join(dataDir, 'gitradar.db'), { create: true, strict: true });
    legacy.exec(`
      CREATE TABLE records (
        member TEXT NOT NULL, email TEXT NOT NULL, org TEXT NOT NULL, org_type TEXT NOT NULL,
        team TEXT NOT NULL, tag TEXT NOT NULL, week TEXT NOT NULL, repo TEXT NOT NULL, grp TEXT NOT NULL,
        commits INTEGER NOT NULL DEFAULT 0, active_days INTEGER NOT NULL DEFAULT 0, active_day_mask INTEGER NOT NULL DEFAULT 0,
        intent_feat INTEGER NOT NULL DEFAULT 0, intent_fix INTEGER NOT NULL DEFAULT 0, intent_refactor INTEGER NOT NULL DEFAULT 0,
        intent_docs INTEGER NOT NULL DEFAULT 0, intent_test INTEGER NOT NULL DEFAULT 0, intent_chore INTEGER NOT NULL DEFAULT 0,
        intent_other INTEGER NOT NULL DEFAULT 0,
        app_files INTEGER NOT NULL DEFAULT 0, app_files_added INTEGER NOT NULL DEFAULT 0, app_files_deleted INTEGER NOT NULL DEFAULT 0,
        app_ins INTEGER NOT NULL DEFAULT 0, app_del INTEGER NOT NULL DEFAULT 0,
        test_files INTEGER NOT NULL DEFAULT 0, test_files_added INTEGER NOT NULL DEFAULT 0, test_files_deleted INTEGER NOT NULL DEFAULT 0,
        test_ins INTEGER NOT NULL DEFAULT 0, test_del INTEGER NOT NULL DEFAULT 0,
        config_files INTEGER NOT NULL DEFAULT 0, config_files_added INTEGER NOT NULL DEFAULT 0, config_files_deleted INTEGER NOT NULL DEFAULT 0,
        config_ins INTEGER NOT NULL DEFAULT 0, config_del INTEGER NOT NULL DEFAULT 0,
        storybook_files INTEGER NOT NULL DEFAULT 0, storybook_files_added INTEGER NOT NULL DEFAULT 0, storybook_files_deleted INTEGER NOT NULL DEFAULT 0,
        storybook_ins INTEGER NOT NULL DEFAULT 0, storybook_del INTEGER NOT NULL DEFAULT 0,
        doc_files INTEGER NOT NULL DEFAULT 0, doc_files_added INTEGER NOT NULL DEFAULT 0, doc_files_deleted INTEGER NOT NULL DEFAULT 0,
        doc_ins INTEGER NOT NULL DEFAULT 0, doc_del INTEGER NOT NULL DEFAULT 0,
        breaking_changes INTEGER NOT NULL DEFAULT 0, scopes TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (member, week, repo)
      );
      CREATE TABLE scan_state (
        repo TEXT PRIMARY KEY, last_hash TEXT NOT NULL, last_scan_date TEXT NOT NULL,
        recent_hashes TEXT NOT NULL DEFAULT '[]', record_count INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO records (member, email, org, org_type, team, tag, week, repo, grp, commits)
      VALUES ('Alice', 'a@x', 'Acme', 'core', 'FE', 'default', '2026-W10', 'web', 'default', 4);
      INSERT INTO scan_state (repo, last_hash, last_scan_date) VALUES ('web', 'a', '2026-03-01T00:00:00Z');
    `);
    legacy.close();

    const [row] = store.queryRecords({});
    expect(row.commits).toBe(4);
    expect(row.prsMergedGit).toBe(0);
    expect(row.prSizes).toEqual([]);
    expect(store.loadScanStateSQL().repos.web.recentPrHashes).toEqual([]);
    store.upsertRecords([makeRecord({ repo: 'api', prsMergedGit: 1, prSizes: [5] })]);
    expect(store.queryRecords({ repo: 'api' })[0].prSizes).toEqual([5]);
  });

  // ── I1: holder records (commits === 0) are not "active" ────────────────────

  it('queryRollup does not count a holder-only member (commits === 0) as active', () => {
    store.upsertRecords([
      makeRecord({ member: 'Alice', commits: 3 }),
      makeRecord({
        member: 'Holder',
        email: 'holder@example.com',
        commits: 0,
        activeDays: 0,
        prsMergedGit: 1,
        prSizes: [200],
        filetype: zeroFiletype(),
      }),
    ]);

    const all = store.queryRollup({}, 'all').get('all')!;
    expect(all.activeMembers).toBe(1);
    // The holder's own counters still roll up — only headcount is gated.
    expect(all.prsMergedGit).toBe(1);
    expect(all.prSizes).toEqual([200]);

    const week = store.queryRollup({}, 'week').get('2026-W10')!;
    expect(week.activeMembers).toBe(1);
  });

  // ── I2: bot exclusion inside queryRollup ───────────────────────────────────
});

// ── Command-level SQL path (contributions / leaderboard) ─────────────────────

describe('contributions SQL fast path', () => {
  let tmpHome: string;
  let dataDir: string;
  const originalOverride = process.env.GITRADAR_HOME;
  let out: string[] = [];
  let originalLog: typeof console.log;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'gitradar-contrib-'));
    dataDir = join(tmpHome, 'data');
    await mkdir(dataDir, { recursive: true });
    process.env.GITRADAR_HOME = tmpHome;
    out = [];
    originalLog = console.log;
    console.log = (...a: unknown[]) => {
      out.push(a.map(String).join(' '));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    store.closeDB();
    if (originalOverride === undefined) delete process.env.GITRADAR_HOME;
    else process.env.GITRADAR_HOME = originalOverride;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('leaves holder-only members out of the segment cohort', async () => {
    const { getCurrentWeek } = await import('../aggregator/filters.js');
    const { contributions } = await import('../commands/contributions.js');
    const week = getCurrentWeek();

    // Nine real contributors, descending by lines: mem01 (900) … mem09 (100).
    const records: UserWeekRepoRecord[] = [];
    for (let i = 1; i <= 9; i++) {
      records.push(linesRecord(`mem0${i}`, (10 - i) * 100, week));
    }
    // One holder: attributable to the week via a merged PR, but zero commits.
    records.push(
      makeRecord({
        member: 'holderbob',
        email: 'holderbob@example.com',
        week,
        commits: 0,
        activeDays: 0,
        prsMergedGit: 1,
        prSizes: [200],
        filetype: zeroFiletype(),
      }),
    );
    store.upsertRecords(records);

    await contributions({ weeks: 4, groupBy: 'member', segment: 'low', segmentMinN: 8 });
    const text = out.join('\n');

    // Cohort is the nine real contributors (n = 9 → bottom ceil(9 × 20%) = 2).
    expect(text).toContain('mem08');
    expect(text).toContain('mem09');
    // The holder is neither labelled nor counted in n (which would have made
    // the cohort 10 and pushed mem08 out of the bottom two).
    expect(text).not.toContain('holderbob');
    expect(text).not.toContain('mem07');
  });
});

describe('leaderboard SQL segment path', () => {
  let tmpHome: string;
  let dataDir: string;
  const originalOverride = process.env.GITRADAR_HOME;
  let out: string[] = [];
  let originalLog: typeof console.log;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'gitradar-leaderboard-'));
    dataDir = join(tmpHome, 'data');
    await mkdir(dataDir, { recursive: true });
    process.env.GITRADAR_HOME = tmpHome;
    out = [];
    originalLog = console.log;
    console.log = (...a: unknown[]) => {
      out.push(a.map(String).join(' '));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    store.closeDB();
    if (originalOverride === undefined) delete process.env.GITRADAR_HOME;
    else process.env.GITRADAR_HOME = originalOverride;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('leaves holder-only members out of the leaderboard segment cohort', async () => {
    const { getCurrentWeek } = await import('../aggregator/filters.js');
    const { leaderboard } = await import('../commands/leaderboard.js');
    const week = getCurrentWeek();

    const records: UserWeekRepoRecord[] = [];
    for (let i = 1; i <= 9; i++) records.push(linesRecord(`mem0${i}`, (10 - i) * 100, week));
    records.push(
      makeRecord({
        member: 'holderbob',
        email: 'holderbob@example.com',
        week,
        commits: 0,
        activeDays: 0,
        prsMergedGit: 1,
        prSizes: [200],
        filetype: zeroFiletype(),
      }),
    );
    store.upsertRecords(records);

    await leaderboard({ weeks: 4, segment: 'low', segmentMinN: 8, json: true });
    const cols = JSON.parse(out.join('\n')) as Array<{
      entries: Array<{ member: string }>;
    }>;
    const names = new Set(cols.flatMap((c) => c.entries.map((e) => e.member)));
    expect(names.has('holderbob')).toBe(false);
    // n = 9 real contributors → bottom two are mem08 / mem09.
    expect(names).toEqual(new Set(['mem08', 'mem09']));
  });
});
