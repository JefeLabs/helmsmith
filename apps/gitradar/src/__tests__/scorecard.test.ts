import { describe, expect, it } from 'vitest';
import { computeScorecard, METRICS, percentile, sortRows } from '../aggregator/scorecard.js';
import type { EnrichmentStore, UserWeekRepoRecord } from '../types/schema.js';

const SETTINGS = {
  trend_threshold: 0.1,
  scorecard_min_n: 8,
  bot_patterns: ['[bot]', 'dependabot'],
};
const CUR = '2026-W12'; // window 4 = W09..W12, baseline = W05..W08

function rec(
  o: Partial<UserWeekRepoRecord> & { member: string; week: string },
): UserWeekRepoRecord {
  return {
    email: `${o.member.toLowerCase()}@co.com`,
    org: 'Acme',
    orgType: 'core',
    team: 'FE',
    tag: 'default',
    repo: 'web',
    group: 'default',
    commits: 3,
    activeDays: 2,
    activeDayMask: 0b11,
    intent: { feat: 2, fix: 1, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 },
    breakingChanges: 0,
    scopes: ['auth'],
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 10 },
      test: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 50, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...o,
  } as UserWeekRepoRecord;
}

describe('percentile', () => {
  it('uses nearest-rank on a sorted array', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 75)).toBe(30);
    expect(percentile([7], 50)).toBe(7);
  });
});

describe('computeScorecard — normalisation', () => {
  it('divides throughput by ACTIVE weeks, not window weeks', () => {
    const records = [
      rec({ member: 'Alice', week: '2026-W12', commits: 6 }),
      rec({ member: 'Alice', week: '2026-W10', commits: 2 }),
      // W11 and W09: no commits → 2 active weeks
    ];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    const alice = sc.rows[0];
    expect(alice.activeWeeks).toBe(2);
    expect(alice.cells.commitsPerWeek.value).toBe(4);
    expect(alice.cells.daysPerWeek.value).toBe(2); // mask 0b11 → 2 days each active week
  });

  it('a zero-commit holder record (rework only) is not an active week', () => {
    const records = [
      rec({ member: 'Alice', week: '2026-W12', commits: 3 }),
      rec({
        member: 'Alice',
        week: '2026-W11',
        commits: 0,
        activeDays: 0,
        activeDayMask: 0,
        reworkLines: 5,
      }),
    ];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(sc.rows[0].activeWeeks).toBe(1);
    expect(sc.rows[0].cells.commitsPerWeek.value).toBe(3);
  });

  it('computes the baseline from the preceding window and a signed delta', () => {
    const records = [
      rec({ member: 'Alice', week: '2026-W12', commits: 8 }), // window: 8 / 1 active wk
      rec({ member: 'Alice', week: '2026-W07', commits: 4 }), // baseline: 4 / 1 active wk
    ];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(sc.window).toEqual(['2026-W09', '2026-W10', '2026-W11', '2026-W12']);
    expect(sc.baseline).toEqual(['2026-W05', '2026-W06', '2026-W07', '2026-W08']);
    const c = sc.rows[0].cells.commitsPerWeek;
    expect(c.baseline).toBe(4);
    expect(c.deltaPct).toBe(100);
  });

  it('delta is null when there is no baseline', () => {
    const sc = computeScorecard({
      records: [rec({ member: 'Alice', week: '2026-W12' })],
      currentWeek: CUR,
      windowWeeks: 4,
      settings: SETTINGS,
    });
    expect(sc.rows[0].cells.commitsPerWeek.baseline).toBeNull();
    expect(sc.rows[0].cells.commitsPerWeek.deltaPct).toBeNull();
  });
});

describe('computeScorecard — metric definitions', () => {
  it('derives flow, quality and collaboration metrics from records and enrichment', () => {
    const enrichments: EnrichmentStore = {
      version: 1,
      lastUpdated: '',
      enrichments: {
        'Alice::2026-W12::web': {
          prs_opened: 2,
          prs_merged: 2,
          avg_cycle_hrs: 10,
          reviews_given: 4,
          churn_rate_pct: 0,
          pr_feature: 0,
          pr_fix: 0,
          pr_bugfix: 0,
          pr_chore: 0,
          pr_hotfix: 0,
          pr_other: 0,
        },
        // W11 record's repo is 'api' (overridden below), so the enrichment key must match repo 'api',
        // not 'web' — the store is keyed "member::week::repo".
        'Alice::2026-W11::api': {
          prs_opened: 1,
          prs_merged: 1,
          avg_cycle_hrs: 40,
          reviews_given: 2,
          churn_rate_pct: 0,
          pr_feature: 0,
          pr_fix: 0,
          pr_bugfix: 0,
          pr_chore: 0,
          pr_hotfix: 0,
          pr_other: 0,
        },
      },
    };
    const records = [
      rec({
        member: 'Alice',
        week: '2026-W12',
        prsMergedGit: 2,
        prSizes: [100, 300],
        reworkLines: 30,
        reworkSelfLines: 10,
        breakingChanges: 1,
        scopes: ['auth', 'api'],
        intent: { feat: 2, fix: 3, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 },
      }),
      rec({
        member: 'Alice',
        week: '2026-W11',
        repo: 'api',
        prsMergedGit: 1,
        prSizes: [50],
        scopes: ['db'],
      }),
    ];
    const sc = computeScorecard({
      records,
      enrichments,
      currentWeek: CUR,
      windowWeeks: 4,
      settings: SETTINGS,
    });
    const c = sc.rows[0].cells;
    expect(c.prsPerWeek.value).toBe(1.5); // 3 PRs / 2 active weeks
    expect(c.prSizeP50.value).toBe(100); // [50,100,300]
    expect(c.prSizeP75.value).toBe(300);
    expect(c.cycleHrs.value).toBe(20); // (10*2 + 40*1) / (2+1)
    expect(c.reworkPct.value).toBe(10); // 30 / (150+150) inserted
    expect(c.fixToFeat.value).toBeCloseTo(4 / 4); // fix 3+1, feat 2+2
    expect(c.testPct.value).toBe(31); // 100 test / (220 app + 100 test)
    expect(c.breaking.value).toBe(1);
    expect(c.reviews.value).toBe(6);
    expect(c.reviewsPerPr.value).toBe(2); // 6 / max(3 proxy, 3 opened)
    expect(c.repos.value).toBe(2);
    expect(c.scopes.value).toBe(3);
    expect(sc.sources).toEqual({ enrichment: true, prProxy: true, rework: true });
  });

  it('returns null cells (not zero) when a source is absent', () => {
    const sc = computeScorecard({
      records: [rec({ member: 'Alice', week: '2026-W12' })],
      currentWeek: CUR,
      windowWeeks: 4,
      settings: SETTINGS,
    });
    const c = sc.rows[0].cells;
    expect(c.prSizeP50.value).toBeNull();
    expect(c.cycleHrs.value).toBeNull();
    expect(c.reviews.value).toBeNull();
    expect(c.reworkPct.value).toBeNull();
    expect(c.fixToFeat.value).toBe(0.5);
    expect(sc.sources).toEqual({ enrichment: false, prProxy: false, rework: false });
  });

  it('METRICS lists 14 metrics, 10 of them core, in family order', () => {
    expect(METRICS).toHaveLength(14);
    expect(METRICS.filter((m) => m.core)).toHaveLength(10);
    expect(METRICS.map((m) => m.family)).toEqual([
      'throughput',
      'throughput',
      'throughput',
      'flow',
      'flow',
      'flow',
      'quality',
      'quality',
      'quality',
      'quality',
      'collab',
      'collab',
      'collab',
      'collab',
    ]);
  });
});

describe('computeScorecard — cohort, percentiles, bots, composite', () => {
  const cohort = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      rec({ member: `M${i}`, week: '2026-W12', commits: (i + 1) * 2 }),
    );

  it('suppresses percentiles below minN and computes them at or above it', () => {
    const small = computeScorecard({
      records: cohort(5),
      currentWeek: CUR,
      windowWeeks: 4,
      settings: SETTINGS,
    });
    expect(small.cohortSize).toBe(5);
    expect(small.rows.every((r) => r.cells.commitsPerWeek.percentile === null)).toBe(true);

    const big = computeScorecard({
      records: cohort(8),
      currentWeek: CUR,
      windowWeeks: 4,
      settings: SETTINGS,
    });
    const byName = new Map(big.rows.map((r) => [r.member, r]));
    expect(byName.get('M0')!.cells.commitsPerWeek.percentile).toBe(0);
    expect(byName.get('M7')!.cells.commitsPerWeek.percentile).toBe(100);
    expect(byName.get('M3')!.cells.commitsPerWeek.percentile).toBe(43); // 3 below / 7
  });

  it('excludes bot authors from rows and cohort', () => {
    const records = [
      ...cohort(8),
      rec({ member: 'dependabot[bot]', week: '2026-W12', commits: 900 }),
    ];
    const sc = computeScorecard({ records, currentWeek: CUR, windowWeeks: 4, settings: SETTINGS });
    expect(sc.cohortSize).toBe(8);
    expect(sc.rows.some((r) => r.member.includes('bot'))).toBe(false);
  });

  it('has no score unless weights are configured; weights are direction-aware', () => {
    const none = computeScorecard({
      records: cohort(8),
      currentWeek: CUR,
      windowWeeks: 4,
      settings: SETTINGS,
    });
    expect(none.hasScore).toBe(false);
    expect(none.rows[0].score).toBeNull();

    const records = cohort(8).map((r, i) => ({ ...r, reworkLines: (8 - i) * 10 })); // M0 has most rework
    const weighted = computeScorecard({
      records,
      currentWeek: CUR,
      windowWeeks: 4,
      settings: { ...SETTINGS, scorecard_weights: { commitsPerWeek: 1, reworkPct: 1 } },
    });
    expect(weighted.hasScore).toBe(true);
    const byName = new Map(weighted.rows.map((r) => [r.member, r]));
    // M7: commits pctl 100, rework pctl 0 (least rework, low-is-better → adj 100) → 100
    expect(byName.get('M7')!.score).toBe(100);
    expect(byName.get('M0')!.score).toBe(0);
  });

  it('score ignores metrics without a percentile and is null when none apply', () => {
    const sc = computeScorecard({
      records: cohort(8),
      currentWeek: CUR,
      windowWeeks: 4,
      settings: { ...SETTINGS, scorecard_weights: { reviews: 5, commitsPerWeek: 1 } }, // no enrichment → reviews null
    });
    expect(new Map(sc.rows.map((r) => [r.member, r])).get('M7')!.score).toBe(100);
    const onlyNull = computeScorecard({
      records: cohort(8),
      currentWeek: CUR,
      windowWeeks: 4,
      settings: { ...SETTINGS, scorecard_weights: { reviews: 5 } },
    });
    expect(onlyNull.rows[0].score).toBeNull();
  });
});

describe('sortRows', () => {
  it('sorts by a metric with nulls last, and by member name', () => {
    const sc = computeScorecard({
      records: [
        rec({ member: 'B', week: '2026-W12', commits: 1 }),
        rec({ member: 'A', week: '2026-W12', commits: 5 }),
        rec({ member: 'C', week: '2026-W12', commits: 3, prsMergedGit: 1, prSizes: [9] }),
      ],
      currentWeek: CUR,
      windowWeeks: 4,
      settings: SETTINGS,
    });
    expect(sortRows(sc.rows, 'commitsPerWeek', true).map((r) => r.member)).toEqual(['A', 'C', 'B']);
    expect(sortRows(sc.rows, 'prSizeP50', true).map((r) => r.member)).toEqual(['C', 'A', 'B']);
    expect(sortRows(sc.rows, 'prSizeP50', false).map((r) => r.member)).toEqual(['C', 'A', 'B']);
    expect(sortRows(sc.rows, 'member', false).map((r) => r.member)).toEqual(['A', 'B', 'C']);
  });
});
