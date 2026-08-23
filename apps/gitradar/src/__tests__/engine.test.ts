import { describe, expect, it } from 'vitest';
import { rollup } from '../aggregator/engine.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: 'alice',
    email: 'alice@example.com',
    org: 'Acme',
    orgType: 'core',
    team: 'Platform',
    tag: 'infrastructure',
    week: '2026-W08',
    repo: 'web-app',
    group: 'web',
    commits: 5,
    activeDays: 3,
    filetype: {
      app: { files: 10, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
      test: { files: 4, filesAdded: 0, filesDeleted: 0, insertions: 40, deletions: 10 },
      config: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 5 },
      storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 8, deletions: 2 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('rollup', () => {
  it('returns an empty map when given no records', () => {
    const result = rollup([], (r) => r.org);
    expect(result.size).toBe(0);
  });

  it('groups records by a single dimension (org)', () => {
    const records = [
      makeRecord({ org: 'Acme', member: 'alice', commits: 3 }),
      makeRecord({ org: 'Acme', member: 'bob', commits: 7 }),
      makeRecord({ org: 'Globex', member: 'carol', commits: 5 }),
    ];

    const result = rollup(records, (r) => r.org);

    expect(result.size).toBe(2);
    expect(result.has('Acme')).toBe(true);
    expect(result.has('Globex')).toBe(true);
  });

  it('sums commits across grouped records', () => {
    const records = [
      makeRecord({ org: 'Acme', commits: 3 }),
      makeRecord({ org: 'Acme', commits: 7 }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    expect(acme.commits).toBe(10);
  });

  it('unions activeDays for one member across repos in the same week (mask-aware)', () => {
    const records = [
      // Mon, Tue, Wed in web-app
      makeRecord({ member: 'alice', repo: 'web-app', activeDays: 3, activeDayMask: 0b0000111 }),
      // Tue, Wed in api — overlaps entirely with the days above
      makeRecord({ member: 'alice', repo: 'api', activeDays: 2, activeDayMask: 0b0000110 }),
      // Fri in infra — a genuinely new day
      makeRecord({ member: 'alice', repo: 'infra', activeDays: 1, activeDayMask: 0b0010000 }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    // Naive sum would be 6; the real number of distinct days is 4
    expect(acme.activeDays).toBe(4);
  });

  it('keeps activeDays per member-week separate when unioning', () => {
    const records = [
      makeRecord({
        member: 'alice',
        repo: 'web-app',
        week: '2026-W08',
        activeDays: 2,
        activeDayMask: 0b11,
      }),
      makeRecord({
        member: 'alice',
        repo: 'api',
        week: '2026-W09',
        activeDays: 2,
        activeDayMask: 0b11,
      }),
      makeRecord({
        member: 'bob',
        repo: 'api',
        week: '2026-W08',
        activeDays: 2,
        activeDayMask: 0b11,
      }),
    ];

    const acme = rollup(records, (r) => r.org).get('Acme')!;
    // Different weeks and different members never collapse into each other
    expect(acme.activeDays).toBe(6);
  });

  it('falls back to summing activeDays for legacy records without a mask', () => {
    const records = [
      makeRecord({ member: 'alice', repo: 'web-app', activeDays: 3 }),
      makeRecord({ member: 'alice', repo: 'api', activeDays: 2 }),
    ];

    const acme = rollup(records, (r) => r.org).get('Acme')!;
    expect(acme.activeDays).toBe(5);
  });

  it('caps a mixed mask + legacy member-week at 7 days', () => {
    const records = [
      makeRecord({ member: 'alice', repo: 'web-app', activeDays: 5, activeDayMask: 0b0011111 }),
      makeRecord({ member: 'alice', repo: 'api', activeDays: 4 }),
    ];

    const acme = rollup(records, (r) => r.org).get('Acme')!;
    expect(acme.activeDays).toBe(7);
  });

  it('sums activeDays across grouped records', () => {
    const records = [
      makeRecord({ member: 'alice', activeDays: 3 }),
      makeRecord({ member: 'bob', activeDays: 5 }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    expect(acme.activeDays).toBe(8);
  });

  it('computes insertions as sum of all filetype insertions', () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    // 100 (app) + 40 (test) + 15 (config) + 8 (storybook) = 163
    expect(acme.insertions).toBe(163);
  });

  it('computes deletions as sum of all filetype deletions', () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    // 20 (app) + 10 (test) + 5 (config) + 2 (storybook) = 37
    expect(acme.deletions).toBe(37);
  });

  it('computes netLines as insertions minus deletions', () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    // 163 - 37 = 126
    expect(acme.netLines).toBe(126);
  });

  it('computes filesChanged as sum of all filetype files', () => {
    const records = [makeRecord()];
    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    // 10 (app) + 4 (test) + 2 (config) + 1 (storybook) = 17
    expect(acme.filesChanged).toBe(17);
  });

  it('tracks unique members for activeMembers count', () => {
    const records = [
      makeRecord({ member: 'alice' }),
      makeRecord({ member: 'alice' }),
      makeRecord({ member: 'bob' }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    expect(acme.activeMembers).toBe(2);
  });

  it('does not count a holder-only member (commits === 0) as active', () => {
    // Post-pass records (PR proxy / rework) carry commits === 0: the member is
    // *attributable* to the week, not active in it.
    const records = [
      makeRecord({ member: 'alice', commits: 4 }),
      makeRecord({
        member: 'holder-bob',
        commits: 0,
        activeDays: 0,
        prsMergedGit: 1,
        prSizes: [200],
        filetype: {
          app: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const acme = rollup(records, (r) => r.org).get('Acme')!;

    expect(acme.activeMembers).toBe(1);
    // The holder's own counters still roll up — only headcount is gated.
    expect(acme.prsMergedGit).toBe(1);
    expect(acme.prSizes).toEqual([200]);
  });

  it('sums filetype breakdown across records', () => {
    const records = [
      makeRecord({
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 50, deletions: 10 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 20, deletions: 5 },
          config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 2 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
      makeRecord({
        filetype: {
          app: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 8 },
          test: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 15, deletions: 3 },
          config: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 12, deletions: 4 },
          storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 5, deletions: 1 },
          doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    expect(acme.filetype.app).toEqual({
      files: 8,
      filesAdded: 0,
      filesDeleted: 0,
      insertions: 80,
      deletions: 18,
    });
    expect(acme.filetype.test).toEqual({
      files: 3,
      filesAdded: 0,
      filesDeleted: 0,
      insertions: 35,
      deletions: 8,
    });
    expect(acme.filetype.config).toEqual({
      files: 3,
      filesAdded: 0,
      filesDeleted: 0,
      insertions: 22,
      deletions: 6,
    });
    expect(acme.filetype.storybook).toEqual({
      files: 1,
      filesAdded: 0,
      filesDeleted: 0,
      insertions: 5,
      deletions: 1,
    });
    expect(acme.filetype.doc).toEqual({
      files: 0,
      filesAdded: 0,
      filesDeleted: 0,
      insertions: 0,
      deletions: 0,
    });
  });

  it('groups by team dimension', () => {
    const records = [
      makeRecord({ team: 'Platform', commits: 10 }),
      makeRecord({ team: 'Frontend', commits: 8 }),
      makeRecord({ team: 'Platform', commits: 4 }),
    ];

    const result = rollup(records, (r) => r.team);

    expect(result.size).toBe(2);
    expect(result.get('Platform')!.commits).toBe(14);
    expect(result.get('Frontend')!.commits).toBe(8);
  });

  it('groups by member dimension', () => {
    const records = [
      makeRecord({ member: 'alice', commits: 10 }),
      makeRecord({ member: 'bob', commits: 5 }),
      makeRecord({ member: 'alice', commits: 3 }),
    ];

    const result = rollup(records, (r) => r.member);

    expect(result.size).toBe(2);
    expect(result.get('alice')!.commits).toBe(13);
    expect(result.get('bob')!.commits).toBe(5);
  });

  it('groups by week dimension', () => {
    const records = [
      makeRecord({ week: '2026-W07', commits: 10 }),
      makeRecord({ week: '2026-W08', commits: 5 }),
      makeRecord({ week: '2026-W07', commits: 3 }),
    ];

    const result = rollup(records, (r) => r.week);

    expect(result.size).toBe(2);
    expect(result.get('2026-W07')!.commits).toBe(13);
    expect(result.get('2026-W08')!.commits).toBe(5);
  });

  it('groups by composite key', () => {
    const records = [
      makeRecord({ org: 'Acme', week: '2026-W07', commits: 10 }),
      makeRecord({ org: 'Acme', week: '2026-W08', commits: 5 }),
      makeRecord({ org: 'Globex', week: '2026-W07', commits: 3 }),
    ];

    const result = rollup(records, (r) => `${r.org}:${r.week}`);

    expect(result.size).toBe(3);
    expect(result.get('Acme:2026-W07')!.commits).toBe(10);
    expect(result.get('Acme:2026-W08')!.commits).toBe(5);
    expect(result.get('Globex:2026-W07')!.commits).toBe(3);
  });

  it('handles a single record correctly', () => {
    const records = [
      makeRecord({
        member: 'alice',
        commits: 7,
        activeDays: 4,
        filetype: {
          app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 50, deletions: 10 },
          test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 20, deletions: 5 },
          config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
          doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        },
      }),
    ];

    const result = rollup(records, (r) => r.org);
    const acme = result.get('Acme')!;

    expect(acme.commits).toBe(7);
    expect(acme.activeDays).toBe(4);
    expect(acme.insertions).toBe(70);
    expect(acme.deletions).toBe(15);
    expect(acme.netLines).toBe(55);
    expect(acme.filesChanged).toBe(7);
    expect(acme.activeMembers).toBe(1);
  });

  it('sums PR-proxy and rework counters and concatenates prSizes', () => {
    const records = [
      makeRecord({
        member: 'alice',
        repo: 'web-app',
        prsMergedGit: 1,
        prSizes: [100],
        reworkLines: 2,
        reworkSelfLines: 1,
      }),
      makeRecord({
        member: 'alice',
        repo: 'api',
        prsMergedGit: 2,
        prSizes: [30, 70],
        reworkLines: 5,
        reworkSelfLines: 0,
      }),
      makeRecord({ member: 'bob', repo: 'api' }), // legacy record: fields absent
    ];
    const acme = rollup(records, (r) => r.org).get('Acme')!;
    expect(acme.prsMergedGit).toBe(3);
    expect(acme.prSizes).toEqual([100, 30, 70]);
    expect(acme.reworkLines).toBe(7);
    expect(acme.reworkSelfLines).toBe(1);
  });
});
