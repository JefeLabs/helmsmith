import { describe, expect, it } from 'vitest';
import { computeScorecard } from '../aggregator/scorecard.js';
import type { UserWeekRepoRecord } from '../types/schema.js';
import { stripAnsi } from '../ui/format.js';
import {
  buildScorecardHotkeys,
  defaultScorecardState,
  moveSort,
  renderScorecard,
  visibleMetricKeys,
} from '../views/components/scorecard-section.js';

const SETTINGS = { trend_threshold: 0.1, scorecard_min_n: 8, bot_patterns: [] as string[] };
function rec(
  member: string,
  commits: number,
  extra: Partial<UserWeekRepoRecord> = {},
): UserWeekRepoRecord {
  return {
    member,
    email: `${member}@co.com`,
    org: 'Acme',
    orgType: 'core',
    team: 'FE',
    tag: 'default',
    week: '2026-W12',
    repo: 'web',
    group: 'default',
    commits,
    activeDays: 2,
    activeDayMask: 0b11,
    intent: { feat: 1, fix: 1, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 },
    breakingChanges: 0,
    scopes: [],
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 0 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...extra,
  };
}
const eight = Array.from({ length: 8 }, (_, i) => rec(`M${i}`, i + 1));
const sc = computeScorecard({
  records: eight,
  currentWeek: '2026-W12',
  windowWeeks: 4,
  settings: SETTINGS,
});

describe('visibleMetricKeys / moveSort', () => {
  it('overview shows member + 10 core metrics (+ score when configured)', () => {
    const keys = visibleMetricKeys(defaultScorecardState(4), false);
    expect(keys[0]).toBe('member');
    expect(keys).toHaveLength(11);
    expect(visibleMetricKeys(defaultScorecardState(4), true)).toContain('score');
  });
  it('family pages show only that family', () => {
    const keys = visibleMetricKeys({ ...defaultScorecardState(4), family: 'flow' }, false);
    expect(keys).toEqual(['member', 'prSizeP50', 'prSizeP75', 'cycleHrs']);
  });
  it('moveSort wraps around the visible columns', () => {
    let s = defaultScorecardState(4);
    expect(s.sortKey).toBe('commitsPerWeek');
    s = moveSort(s, -1, false);
    expect(s.sortKey).toBe('member');
    s = moveSort(s, -1, false);
    expect(s.sortKey).toBe('repos');
  });
});

describe('renderScorecard', () => {
  it('renders one row per member sorted by the sort key, with header labels', () => {
    const out = stripAnsi(renderScorecard(sc, defaultScorecardState(4), 160));
    expect(out).toContain('cmt/wk');
    const rows = out.split('\n').filter((l) => /\bM\d\b/.test(l));
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatch(/M7/); // highest commits first (desc)
  });
  it('shows n<8 for percentiles when the cohort is too small', () => {
    const small = computeScorecard({
      records: eight.slice(0, 3),
      currentWeek: '2026-W12',
      windowWeeks: 4,
      settings: SETTINGS,
    });
    const out = stripAnsi(
      renderScorecard(small, { ...defaultScorecardState(4), mode: 'pctl' }, 160),
    );
    expect(out).toContain('n<8');
  });
  it('renders — for null cells and a sources footer', () => {
    const out = stripAnsi(renderScorecard(sc, defaultScorecardState(4), 160));
    expect(out).toMatch(/cycle[\s\S]*—/);
    expect(out).toMatch(/sources: rework –, PR proxy –, enrichment –/);
    expect(out).toMatch(/cohort 8/);
  });
  it('delta mode shows signed percentages with trend glyphs', () => {
    const withBase = computeScorecard({
      records: [...eight, rec('M7', 2, { week: '2026-W07' })],
      currentWeek: '2026-W12',
      windowWeeks: 4,
      settings: SETTINGS,
    });
    const out = stripAnsi(
      renderScorecard(withBase, { ...defaultScorecardState(4), mode: 'delta' }, 160),
    );
    expect(out).toMatch(/M7.*▲\s*\+?300%/);
  });
});

describe('buildScorecardHotkeys', () => {
  it('lists window, family, mode, sort and reverse keys', () => {
    const keys = buildScorecardHotkeys(defaultScorecardState(8)).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(['1/2/3', 'F', 'N', '←/→', 'R']));
  });
});
