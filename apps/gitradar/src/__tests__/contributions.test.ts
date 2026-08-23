/**
 * Flat-mode `contributions` segmentation must apply the same holder-record gate
 * the SQL path already applies: a record with `commits === 0` is a PR-proxy /
 * rework attribution, not evidence of work, so it must not join the segment
 * cohort (which sets both the min-n threshold and the percentile boundaries).
 */
import { describe, expect, it, vi } from 'vitest';
import { getCurrentWeek } from '../aggregator/filters.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

vi.mock('../store/sqlite-store.js', () => ({
  queryRecords: vi.fn(() => []),
  queryRollup: vi.fn(() => new Map()),
}));

import { contributions } from '../commands/contributions.js';

function zeroFiletype(): UserWeekRepoRecord['filetype'] {
  return {
    app: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
  };
}

function makeRecord(member: string, commits: number, lines: number): UserWeekRepoRecord {
  return {
    member,
    email: `${member}@example.com`,
    org: 'Acme',
    orgType: 'core',
    team: 'Platform',
    tag: 'default',
    week: getCurrentWeek(),
    repo: 'web',
    group: 'default',
    commits,
    activeDays: commits > 0 ? 2 : 0,
    filetype: {
      ...zeroFiletype(),
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: lines, deletions: 0 },
    },
  };
}

/** Run flat-mode contributions in JSON mode and return the parsed rows. */
async function flatSegments(
  records: UserWeekRepoRecord[],
  segmentMinN: number,
): Promise<Map<string, string>> {
  const logged: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
  try {
    await contributions({ records, json: true, segmentMinN });
  } finally {
    spy.mockRestore();
  }
  const rows = JSON.parse(logged.join('\n')) as Array<{ name: string; segment: string }>;
  return new Map(rows.map((r) => [r.name, r.segment]));
}

const reals = [700, 600, 500, 400, 300, 200, 100].map((lines, i) => makeRecord(`m${i}`, 3, lines));
const holder = makeRecord('holder', 0, 0);

describe('contributions — flat mode segment cohort', () => {
  it('a holder-only member does not lift the cohort over segment_min_n', async () => {
    const segments = await flatSegments([...reals, holder], 8);

    expect([...segments.values()].filter((s) => s === 'high')).toEqual([]);
    expect([...segments.values()].filter((s) => s === 'low')).toEqual([]);
    expect(segments.get('m0')).toBe('middle');
  });

  it('a holder-only member does not shift the percentile boundaries', async () => {
    const withHolder = await flatSegments([...reals, holder], 7);
    const withoutHolder = await flatSegments(reals, 7);

    for (const r of reals) {
      expect(withHolder.get(r.member), r.member).toBe(withoutHolder.get(r.member));
    }
  });
});
