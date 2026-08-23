import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '../aggregator/segments.js';
import type { Config, UserWeekRepoRecord } from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';
import { stripAnsi } from '../ui/format.js';
import {
  buildContributionGroups,
  renderContributionsTab,
  type TimeBucket,
} from '../views/components/contribution-section.js';
import type { ViewContext } from '../views/types.js';

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

describe('renderContributionsTab — by-entity pivot segmentation', () => {
  /** Render into a captured, ANSI-stripped line array. */
  function renderLines(records: UserWeekRepoRecord[]): string[] {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    try {
      const ctx: ViewContext = { config: makeConfig(), records, currentWeek: '2026-W10' };
      renderContributionsTab(
        ctx,
        'user',
        false,
        true, // pivotEntity
        BUCKETS,
        'week',
        'range',
        120,
        '',
        () => 'steady',
        undefined,
        records,
        new Set<Segment>(['low']),
      );
    } finally {
      spy.mockRestore();
    }
    return stripAnsi(logged.join('\n')).split('\n');
  }

  /** The group-label prefix (segment glyph, if any) before the `┤` axis char, per entity. */
  function visibleEntities(lines: string[]): Map<string, string> {
    const result = new Map<string, string>();
    for (const line of lines) {
      const idx = line.indexOf('┤');
      if (idx === -1) continue;
      const label = line.slice(0, idx).trim();
      const match = /^(?:([▲●▼])\s+)?(m\d)$/.exec(label);
      if (match) result.set(match[2], match[1] ?? '');
    }
    return result;
  }

  it('by-entity pivot segmentation ignores holder-only entities', () => {
    // 8 real members (commits > 0) with distinct totals, spread across
    // high/middle/low once segmented (min-N of 8 is exactly cleared).
    const totals = [800, 700, 600, 500, 400, 300, 200, 100];
    const realMembers = totals.map((total, i) =>
      makeRecord({
        member: `m${i}`,
        email: `m${i}@example.com`,
        commits: 3,
        filetype: {
          ...zeroFiletype(),
          app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: total, deletions: 0 },
        },
      }),
    );
    // A holder-only member: commits === 0, present only via a PR-proxy/rework
    // record. Must not enter the entity segment cohort at all.
    const holder = makeRecord({
      member: 'holder0',
      email: 'holder0@example.com',
      commits: 0,
      activeDays: 0,
      prsMergedGit: 1,
      filetype: zeroFiletype(),
    });

    const withoutHolder = visibleEntities(renderLines(realMembers));
    const withHolder = visibleEntities(renderLines([...realMembers, holder]));

    // n stays 8: the same real members are visible, with the same segment glyphs.
    expect([...withHolder.keys()].sort()).toEqual([...withoutHolder.keys()].sort());
    for (const [member, glyph] of withoutHolder) {
      expect(withHolder.get(member)).toBe(glyph);
    }

    // The holder itself still renders (not hidden by the 'low' exclusion).
    const holderLines = renderLines([...realMembers, holder]);
    expect(holderLines.some((l) => l.includes('holder0'))).toBe(true);
  });
});
