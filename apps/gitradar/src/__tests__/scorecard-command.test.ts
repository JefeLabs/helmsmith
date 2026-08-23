import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scorecard } from '../commands/scorecard.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

function rec(member: string, commits: number, team = 'FE'): UserWeekRepoRecord {
  return {
    member,
    email: `${member}@co.com`,
    org: 'Acme',
    orgType: 'core',
    team,
    tag: 'default',
    week: '2026-W12',
    repo: 'web',
    group: 'default',
    commits,
    activeDays: 1,
    activeDayMask: 1,
    intent: { feat: 1, fix: 0, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 },
    breakingChanges: 0,
    scopes: [],
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 0 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
  };
}
const SETTINGS = { trend_threshold: 0.1, scorecard_min_n: 8, bot_patterns: [] as string[] };

describe('view scorecard', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.join(' '));
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z')); // inside 2026-W12
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('--json emits the full Scorecard object', async () => {
    await scorecard({
      records: [rec('A', 4), rec('B', 2)],
      json: true,
      settings: SETTINGS,
      weeks: 4,
    });
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.cohortSize).toBe(2);
    expect(parsed.rows.map((r: { member: string }) => r.member)).toEqual(['A', 'B']);
    expect(parsed.rows[0].cells.commitsPerWeek.value).toBe(4);
  });

  it('renders a table honouring --sort/--asc and filters', async () => {
    await scorecard({
      records: [rec('alpha', 4), rec('bravo', 2), rec('charlie', 9, 'BE')],
      settings: SETTINGS,
      weeks: 4,
      sort: 'commitsPerWeek',
      asc: true,
      filters: { team: 'FE' },
    });
    const text = out.join('\n');
    expect(text).toContain('cmt/wk');
    expect(text.indexOf('bravo')).toBeLessThan(text.indexOf('alpha'));
    expect(text).not.toContain('charlie');
  });

  it('prints the no-data hint when nothing is in the window', async () => {
    await scorecard({ records: [], settings: SETTINGS });
    expect(out.join('\n')).toMatch(/No contributors|Run "gitradar scan"/);
  });

  it('--json emits an empty Scorecard rather than prose on an empty window', async () => {
    await scorecard({ records: [], settings: SETTINGS, json: true, weeks: 4 });
    const text = out.join('\n');
    expect(text).not.toMatch(/No contributors|Run "gitradar scan"/);
    const parsed = JSON.parse(text);
    expect(parsed.rows).toEqual([]);
    expect(parsed.cohortSize).toBe(0);
    expect(parsed.window).toHaveLength(4);
  });
});
