import { describe, expect, it } from 'vitest';
import type { Config, UserWeekRepoRecord } from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';
import {
  buildContributionGroups,
  type TimeBucket,
} from '../views/components/contribution-section.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function zeroFiletype(): UserWeekRepoRecord['filetype'] {
  return {
    app: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
  };
}

function makeRecord(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: 'alice',
    email: 'alice@example.com',
    org: 'Acme',
    orgType: 'core',
    team: 'Platform',
    tag: 'default',
    week: '2026-W10',
    repo: 'web',
    group: 'default',
    commits: 3,
    activeDays: 2,
    filetype: {
      ...zeroFiletype(),
      app: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 80, deletions: 20 },
    },
    ...overrides,
  };
}

function makeConfig(): Config {
  return {
    repos: [],
    orgs: [
      {
        name: 'Acme',
        type: 'core',
        teams: [{ name: 'Platform', tag: 'default', members: [] }],
      },
    ],
    groups: {},
    tags: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

const BUCKETS: TimeBucket[] = [{ label: 'W10', weeks: ['2026-W10'] }];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildContributionGroups — user level', () => {
  it('emits one bar per committing member', () => {
    const groups = buildContributionGroups(
      [makeRecord({ member: 'alice' }), makeRecord({ member: 'bob' })],
      BUCKETS,
      'user',
      false,
      makeConfig(),
    );
    expect(groups[0].bars.map((b) => b.label).sort()).toEqual(['alice', 'bob']);
  });

  it('omits holder-only members (commits === 0) from user-level bars', () => {
    // "holderbob" only exists in this week because a PR he authored merged here
    // (PR proxy) — he has no commits, no lines, and must not be rendered as a
    // zero-length bar nor enter the segment cohort built from these bars.
    const groups = buildContributionGroups(
      [
        makeRecord({ member: 'alice' }),
        makeRecord({
          member: 'holderbob',
          email: 'holderbob@example.com',
          commits: 0,
          activeDays: 0,
          prsMergedGit: 1,
          prSizes: [200],
          filetype: zeroFiletype(),
        }),
      ],
      BUCKETS,
      'user',
      false,
      makeConfig(),
    );

    expect(groups[0].bars.map((b) => b.label)).toEqual(['alice']);
  });

  it('keeps a member who has both a holder record and a real commit record', () => {
    const groups = buildContributionGroups(
      [
        makeRecord({ member: 'bob', repo: 'web' }),
        makeRecord({
          member: 'bob',
          repo: 'api',
          commits: 0,
          activeDays: 0,
          prsMergedGit: 1,
          filetype: zeroFiletype(),
        }),
      ],
      BUCKETS,
      'user',
      false,
      makeConfig(),
    );

    expect(groups[0].bars.map((b) => b.label)).toEqual(['bob']);
    expect(groups[0].bars[0].commits).toBe(3);
  });
});
