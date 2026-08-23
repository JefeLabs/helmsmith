/**
 * `GitRadarEngine.enrich` must never persist a member-week it has no GitHub data
 * for: an all-zero row is both a lie in the CSV/TUI and sticky, because
 * `hasEnrichment(key)` then makes the next run skip it as "already enriched".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubMetrics } from '../collector/github.js';
import type { Config, UserWeekRepoRecord } from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('ora', () => {
  const spinner = {
    start: vi.fn(() => spinner),
    succeed: vi.fn(() => spinner),
    warn: vi.fn(() => spinner),
    fail: vi.fn(() => spinner),
    stop: vi.fn(() => spinner),
    text: '',
  };
  return { default: vi.fn(() => spinner) };
});

vi.mock('../store/sqlite-store.js', () => ({
  deleteRecordsForRepo: vi.fn(),
  deleteScanStateForRepo: vi.fn(),
  getMetaTimestamps: vi.fn(() => ({})),
  getSQLitePath: vi.fn(() => '/tmp/does-not-exist.db'),
  getStoreStatsSQLFull: vi.fn(() => ({})),
  hasEnrichment: vi.fn(() => false),
  loadAuthorRegistrySQL: vi.fn(() => ({ version: 1, authors: {} })),
  loadEnrichmentsSQL: vi.fn(() => ({ version: 1, lastUpdated: '', enrichments: {} })),
  loadScanStateSQL: vi.fn(() => ({ version: 1, repos: {} })),
  pruneRecordsSQL: vi.fn(),
  queryRecords: vi.fn(() => []),
  queryRollup: vi.fn(() => []),
  resetAllData: vi.fn(),
  saveAuthorRegistrySQL: vi.fn(),
  saveEnrichmentBatchSQL: vi.fn(),
  saveScanStateSQL: vi.fn(),
  upsertRecords: vi.fn(),
}));

vi.mock('../collector/github.js', () => ({
  createCacheStats: vi.fn(() => ({ hits: 0, misses: 0 })),
  createOctokit: vi.fn(async () => ({}) as unknown),
  detectGitHubRemote: vi.fn(async () => ({ owner: 'acme', repo: 'web' })),
  fetchGitHubMetricsBatch: vi.fn(async () => ({ results: [], failedHandles: [] })),
  GitHubRateLimiter: class {
    async acquire() {}
    updateFromGraphQL() {}
  },
}));

import { createOctokit, detectGitHubRemote, fetchGitHubMetricsBatch } from '../collector/github.js';
import { GitRadarEngine, selectPersistable } from '../engine/gitradar-engine.js';
import { queryRecords, saveEnrichmentBatchSQL } from '../store/sqlite-store.js';

const mockCreateOctokit = vi.mocked(createOctokit);
const mockDetectRemote = vi.mocked(detectGitHubRemote);
const mockFetchBatch = vi.mocked(fetchGitHubMetricsBatch);
const mockQueryRecords = vi.mocked(queryRecords);
const mockSaveBatch = vi.mocked(saveEnrichmentBatchSQL);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function ghMetrics(overrides: Partial<GitHubMetrics> = {}): GitHubMetrics {
  return {
    prs_opened: 4,
    prs_merged: 3,
    median_cycle_hrs: 12.5,
    prs_reviewed_touched: 7,
    pr_feature: 1,
    pr_fix: 0,
    pr_bugfix: 0,
    pr_chore: 0,
    pr_hotfix: 0,
    pr_other: 3,
    ...overrides,
  };
}

function makeRecord(week: string, who = { member: 'Alice Chen', email: 'alice@acme.com' }) {
  return {
    member: who.member,
    email: who.email,
    org: 'Acme',
    orgType: 'core',
    team: 'Platform',
    tag: 'default',
    week,
    repo: 'web',
    group: 'default',
    commits: 5,
    activeDays: 3,
    filetype: {
      app: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
  } satisfies UserWeekRepoRecord;
}

const BOB = { member: 'Bob Ray', email: 'bob@acme.com' };

function makeConfig(): Config {
  return {
    repos: [{ path: '/repos/web', name: 'web', group: 'default' }],
    orgs: [
      {
        name: 'Acme',
        type: 'core',
        teams: [
          {
            name: 'Platform',
            tag: 'default',
            members: [
              { name: 'Alice Chen', aliases: [], email: 'alice@acme.com', githubHandle: 'alice' },
              { name: 'Bob Ray', aliases: [], email: 'bob@acme.com', githubHandle: 'bob' },
            ],
          },
        ],
      },
    ],
    groups: {},
    tags: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Run `enrich` against one member-week, capturing stdout. */
async function runEnrich(): Promise<string> {
  const engine = new GitRadarEngine();
  engine.config = makeConfig();
  const logged: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
  try {
    await engine.enrich({ weeks: 4 });
  } finally {
    spy.mockRestore();
  }
  return logged.join('\n');
}

// ── selectPersistable ────────────────────────────────────────────────────────

describe('selectPersistable', () => {
  const entries = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];

  it('persists only the entries a fetch produced metrics for', () => {
    const fetched = new Map([
      ['a', ghMetrics({ prs_opened: 2 })],
      ['c', ghMetrics({ prs_opened: 9 })],
    ]);

    const { persist, skipped } = selectPersistable(entries, fetched);

    expect(persist.map((p) => p.key)).toEqual(['a', 'c']);
    expect(skipped).toEqual(['b']);
    expect(persist[0].metrics.prs_opened).toBe(2);
    expect(persist[1].metrics.prs_opened).toBe(9);
  });

  it('carries the renamed fields through and zeroes the retired churn column', () => {
    const { persist } = selectPersistable([{ key: 'a' }], new Map([['a', ghMetrics()]]));

    expect(persist[0].metrics).toEqual({
      prs_opened: 4,
      prs_merged: 3,
      median_cycle_hrs: 12.5,
      prs_reviewed_touched: 7,
      churn_rate_pct: 0,
      pr_feature: 1,
      pr_fix: 0,
      pr_bugfix: 0,
      pr_chore: 0,
      pr_hotfix: 0,
      pr_other: 3,
    });
  });

  it('keeps a genuine all-zero fetch — no PRs that week is data, not absence', () => {
    const zero = ghMetrics({
      prs_opened: 0,
      prs_merged: 0,
      median_cycle_hrs: 0,
      prs_reviewed_touched: 0,
      pr_feature: 0,
      pr_other: 0,
    });

    const { persist, skipped } = selectPersistable([{ key: 'a' }], new Map([['a', zero]]));

    expect(persist).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it('skips everything when nothing was fetched', () => {
    const { persist, skipped } = selectPersistable(entries, new Map());

    expect(persist).toEqual([]);
    expect(skipped).toEqual(['a', 'b', 'c']);
  });
});

// ── enrich() ─────────────────────────────────────────────────────────────────

describe('GitRadarEngine.enrich — never stores rows it has no data for', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryRecords.mockReturnValue([makeRecord('2026-W10')]);
    mockCreateOctokit.mockResolvedValue({} as never);
    mockDetectRemote.mockResolvedValue({ owner: 'acme', repo: 'web' });
    mockFetchBatch.mockResolvedValue({ results: [], failedHandles: [] });
  });

  it('persists nothing and returns early when there is no GitHub token', async () => {
    mockCreateOctokit.mockResolvedValue(null);

    const out = await runEnrich();

    expect(mockSaveBatch).not.toHaveBeenCalled();
    expect(mockDetectRemote).not.toHaveBeenCalled();
    expect(out).toContain('No GitHub token found');
    expect(out).not.toContain('Enrichment complete');
  });

  it('skips a repo with no GitHub remote instead of writing zero rows', async () => {
    mockDetectRemote.mockResolvedValue(null);

    const out = await runEnrich();

    expect(mockSaveBatch).not.toHaveBeenCalled();
    expect(out).toContain('0 enriched');
    expect(out).toContain('1 no GitHub data');
  });

  it('skips a member-week whose GraphQL fetch produced nothing', async () => {
    mockFetchBatch.mockResolvedValue({ results: [], failedHandles: [] });

    const out = await runEnrich();

    expect(mockSaveBatch).not.toHaveBeenCalled();
    expect(out).toContain('0 enriched');
    expect(out).toContain('1 no GitHub data');
  });

  it('counts a thrown batch fetch as an error, and still stores nothing', async () => {
    mockFetchBatch.mockRejectedValue(new Error('GraphQL 502'));

    const out = await runEnrich();

    expect(mockSaveBatch).not.toHaveBeenCalled();
    expect(out).toContain('0 enriched');
    expect(out).toContain('1 error');
  });

  it("counts one author's fetch failure as an error while still storing the others", async () => {
    // The batch call resolved; alice's own page (or her REST fallback) failed.
    // That is an error for alice alone — not "GitHub says she had no PRs", and not
    // a reason to drop bob. Nothing may be stored for her, or `hasEnrichment`
    // would skip her for good.
    mockQueryRecords.mockReturnValue([makeRecord('2026-W10'), makeRecord('2026-W10', BOB)]);
    mockFetchBatch.mockResolvedValue({
      results: [{ handle: 'bob', metrics: ghMetrics() }],
      failedHandles: ['alice'],
    });

    const out = await runEnrich();

    const saved = mockSaveBatch.mock.calls[0][0];
    expect(saved.map((e) => e.key)).toEqual(['Bob Ray::2026-W10::web']);
    expect(out).toContain('1 enriched');
    expect(out).toContain('1 error');
    expect(out).not.toContain('no GitHub data');
  });

  it('persists fetched member-weeks with their real values', async () => {
    mockFetchBatch.mockResolvedValue({
      results: [{ handle: 'alice', metrics: ghMetrics() }],
      failedHandles: [],
    });

    const out = await runEnrich();

    expect(mockSaveBatch).toHaveBeenCalledTimes(1);
    const saved = mockSaveBatch.mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].key).toBe('Alice Chen::2026-W10::web');
    expect(saved[0].metrics.median_cycle_hrs).toBe(12.5);
    expect(saved[0].metrics.prs_reviewed_touched).toBe(7);
    expect(out).toContain('1 enriched');
    expect(out).not.toContain('no GitHub data');
  });
});
