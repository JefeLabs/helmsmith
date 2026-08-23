import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWeek } from '../aggregator/filters.js';
import { repoActivity } from '../commands/repo-activity.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

function rec(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: 'alice',
    email: 'alice@co.com',
    org: 'Acme',
    orgType: 'core',
    team: 'Platform',
    tag: 'default',
    week: getCurrentWeek(),
    repo: 'web',
    group: 'default',
    commits: 3,
    activeDays: 1,
    filetype: {
      app: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 0 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

describe('repoActivity — bot exclusion (pre-loaded records path)', () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.map(String).join(' '));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('excludes bot commits from repo totals when botPatterns is given', async () => {
    const records = [
      rec({ member: 'alice', email: 'alice@co.com', commits: 3 }),
      rec({ member: 'bob', email: 'bob@co.com', commits: 3 }),
      rec({ member: 'dependabot[bot]', email: 'noreply@github.com', commits: 100 }),
    ];

    await repoActivity({ records, botPatterns: ['[bot]'], json: true });

    const parsed = JSON.parse(out.join('\n'));
    const web = parsed.find((r: { repo: string }) => r.repo === 'web');
    expect(web.commits).toBe(6);
    expect(web.contributors).toBe(2);
  });

  it('includes bot commits when botPatterns is not given (baseline)', async () => {
    const records = [
      rec({ member: 'alice', email: 'alice@co.com', commits: 3 }),
      rec({ member: 'dependabot[bot]', email: 'noreply@github.com', commits: 100 }),
    ];

    await repoActivity({ records, json: true });

    const parsed = JSON.parse(out.join('\n'));
    const web = parsed.find((r: { repo: string }) => r.repo === 'web');
    expect(web.commits).toBe(103);
  });
});
