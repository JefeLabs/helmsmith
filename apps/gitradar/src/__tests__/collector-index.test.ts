import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '../collector/git.js';
import type { Config, ScanState, UserWeekRepoRecord } from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

const mockScanRepo = vi.fn();

vi.mock('../collector/git.js', () => ({
  scanRepo: (...args: unknown[]) => mockScanRepo(...args),
}));

vi.mock('../collector/author-map.js', () => ({
  buildAuthorMap: vi.fn(() => new Map()),
  buildIdentifierRules: vi.fn(() => []),
}));

const mockRunPrProxy = vi.fn();

vi.mock('../collector/pr-proxy.js', () => ({
  runPrProxy: (...args: unknown[]) => mockRunPrProxy(...args),
}));

const mockRunRework = vi.fn();

vi.mock('../collector/rework.js', () => ({
  runRework: (...args: unknown[]) => mockRunRework(...args),
}));

const { access } = await import('node:fs/promises');
const mockAccess = vi.mocked(access);

const { scanAllRepos } = await import('../collector/index.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSampleConfig(overrides?: Partial<Config>): Config {
  return {
    repos: [
      { path: '/repos/frontend', name: 'frontend', group: 'web' },
      { path: '/repos/backend', name: 'backend', group: 'api' },
    ],
    orgs: [
      {
        name: 'Acme',
        type: 'core',
        teams: [
          {
            name: 'Platform',
            tag: 'default',
            members: [{ name: 'Alice', email: 'alice@acme.com', aliases: [] }],
          },
        ],
      },
    ],
    groups: {},
    tags: {},
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

/** Single-repo config (repo named "app") used by the post-pass wiring tests. */
function makeConfig(overrides?: Partial<Config>): Config {
  return makeSampleConfig({
    repos: [{ path: '/repos/app', name: 'app', group: 'web' }],
    ...overrides,
  });
}

function makeScanState(repos?: ScanState['repos']): ScanState {
  return { version: 1, repos: repos ?? {} };
}

function makeScanResult(overrides?: Partial<ScanResult>): ScanResult {
  return {
    newRecords: [],
    newHashes: [],
    commitCount: 0,
    skippedCount: 0,
    ignoredCommitCount: 0,
    discoveredAuthors: [],
    reworkInputs: [],
    ...overrides,
  };
}

function makeRecord(member: string, repo: string) {
  return {
    member,
    email: `${member.toLowerCase()}@acme.com`,
    org: 'Acme',
    orgType: 'core' as const,
    team: 'Platform',
    tag: 'default',
    week: '2026-W09',
    repo,
    group: 'web',
    commits: 3,
    activeDays: 2,
    filetype: {
      app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 20 },
      test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 5 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('scanAllRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    // PR proxy always runs per repo; default to a no-op result so pre-existing
    // tests that don't care about it aren't affected.
    mockRunPrProxy.mockResolvedValue({ records: [], newPrHashes: [], prCount: 0, branch: 'main' });
    mockRunRework.mockResolvedValue({ records: [], commitsProcessed: 0, blames: 0 });
  });

  it('scans all repos and aggregates results', async () => {
    mockScanRepo
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [makeRecord('Alice', 'frontend')],
          newHashes: ['hash1', 'hash2'],
          commitCount: 5,
        }),
      )
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [makeRecord('Alice', 'backend')],
          newHashes: ['hash3'],
          commitCount: 3,
        }),
      );

    const result = await scanAllRepos(makeSampleConfig(), makeScanState());

    expect(result.allNewRecords).toHaveLength(2);
    expect(result.stats.totalCommits).toBe(8);
    expect(result.stats.totalRecords).toBe(2);
    expect(result.stats.reposScanned).toBe(2);
    expect(result.stats.reposSkipped).toBe(0);
    expect(result.stats.reposMissing).toBe(0);
  });

  it('skips fresh repos (not stale)', async () => {
    const recentDate = new Date().toISOString();
    const state = makeScanState({
      frontend: {
        lastHash: 'abc',
        lastScanDate: recentDate,
        recentHashes: ['abc'],
        recordCount: 10,
      },
    });

    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newRecords: [makeRecord('Alice', 'backend')],
        newHashes: ['xyz'],
        commitCount: 2,
      }),
    );

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await scanAllRepos(makeSampleConfig(), state);

    expect(result.stats.reposSkipped).toBe(1);
    expect(result.stats.reposScanned).toBe(1);
    // scanRepo should only be called once (for backend)
    expect(mockScanRepo).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('frontend: fresh'));

    consoleSpy.mockRestore();
  });

  it('scans all repos when forceScan is true', async () => {
    const recentDate = new Date().toISOString();
    const state = makeScanState({
      frontend: {
        lastHash: 'abc',
        lastScanDate: recentDate,
        recentHashes: ['abc'],
        recordCount: 10,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ commitCount: 1, newHashes: ['h1'] }))
      .mockResolvedValueOnce(makeScanResult({ commitCount: 2, newHashes: ['h2'] }));

    const result = await scanAllRepos(makeSampleConfig(), state, {
      forceScan: true,
    });

    expect(result.stats.reposScanned).toBe(2);
    expect(result.stats.reposSkipped).toBe(0);
    expect(mockScanRepo).toHaveBeenCalledTimes(2);
  });

  it('warns and skips repos with missing paths', async () => {
    mockAccess
      .mockRejectedValueOnce(new Error('ENOENT')) // frontend missing
      .mockResolvedValueOnce(undefined); // backend exists

    mockScanRepo.mockResolvedValueOnce(makeScanResult({ commitCount: 1, newHashes: ['h1'] }));

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await scanAllRepos(makeSampleConfig(), makeScanState());

    expect(result.stats.reposMissing).toBe(1);
    expect(result.stats.reposScanned).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('frontend: path not found'));

    consoleSpy.mockRestore();
  });

  it('updates scan state with new hashes and dates', async () => {
    mockScanRepo
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [makeRecord('Alice', 'frontend')],
          newHashes: ['new1', 'new2'],
          commitCount: 2,
        }),
      )
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [],
          newHashes: ['new3'],
          commitCount: 1,
        }),
      );

    const result = await scanAllRepos(makeSampleConfig(), makeScanState());

    const frontendState = result.updatedScanState.repos.frontend;
    expect(frontendState).toBeDefined();
    expect(frontendState.lastHash).toBe('new1');
    expect(frontendState.recentHashes).toContain('new1');
    expect(frontendState.recentHashes).toContain('new2');
    expect(frontendState.recordCount).toBe(1);

    const backendState = result.updatedScanState.repos.backend;
    expect(backendState).toBeDefined();
    expect(backendState.lastHash).toBe('new3');
    expect(backendState.recordCount).toBe(0);
  });

  it('calculates since date as lastScanDate - 1 day', async () => {
    const state = makeScanState({
      frontend: {
        lastHash: 'old',
        lastScanDate: '2026-02-20T10:00:00.000Z',
        recentHashes: ['old'],
        recordCount: 5,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h1'] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h2'] }));

    await scanAllRepos(makeSampleConfig(), state);

    // First call (frontend) should have since = "2026-02-19"
    const firstCallOptions = mockScanRepo.mock.calls[0][1];
    expect(firstCallOptions.since).toBe('2026-02-19');

    // Second call (backend) should have no since (first scan)
    const secondCallOptions = mockScanRepo.mock.calls[1][1];
    expect(secondCallOptions.since).toBeUndefined();
  });

  it('handles empty repos config gracefully', async () => {
    const config = makeSampleConfig({ repos: [] });
    const result = await scanAllRepos(config, makeScanState());

    expect(result.allNewRecords).toEqual([]);
    expect(result.stats.totalCommits).toBe(0);
    expect(result.stats.reposScanned).toBe(0);
  });

  it('preserves existing scan state for unscanned repos', async () => {
    const existingState = makeScanState({
      'other-repo': {
        lastHash: 'preserved',
        lastScanDate: '2026-01-01T00:00:00Z',
        recentHashes: ['preserved'],
        recordCount: 50,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h1'] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h2'] }));

    const result = await scanAllRepos(makeSampleConfig(), existingState);

    // The unscanned "other-repo" should still be in the state
    expect(result.updatedScanState.repos['other-repo']).toEqual(existingState.repos['other-repo']);
  });

  it('uses custom staleness minutes from options', async () => {
    // Set lastScanDate to 30 minutes ago
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const state = makeScanState({
      frontend: {
        lastHash: 'abc',
        lastScanDate: thirtyMinAgo,
        recentHashes: ['abc'],
        recordCount: 10,
      },
    });

    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h1'] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h2'] }));

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // With stalenessMinutes=15, the 30-min-old scan should be stale
    const result = await scanAllRepos(makeSampleConfig(), state, {
      stalenessMinutes: 15,
    });

    expect(result.stats.reposScanned).toBe(2);
    expect(result.stats.reposSkipped).toBe(0);

    consoleSpy.mockRestore();
  });

  it('calls onRepoScanned after each repo and does not accumulate records', async () => {
    const frontendRecords = [makeRecord('Alice', 'frontend')];
    const backendRecords = [makeRecord('Bob', 'backend')];

    mockScanRepo
      .mockResolvedValueOnce(
        makeScanResult({ newRecords: frontendRecords, newHashes: ['h1'], commitCount: 1 }),
      )
      .mockResolvedValueOnce(
        makeScanResult({ newRecords: backendRecords, newHashes: ['h2'], commitCount: 2 }),
      );

    const flushed: unknown[][] = [];
    const onRepoScanned = vi.fn(async (records: unknown[]) => {
      flushed.push(records);
    });

    const result = await scanAllRepos(makeSampleConfig(), makeScanState(), {
      onRepoScanned,
    });

    // Callback called once per repo. Records are now merged with (empty) post-pass
    // records before the callback, so the array is a new instance — compare by value.
    expect(onRepoScanned).toHaveBeenCalledTimes(2);
    expect(flushed[0]).toEqual(frontendRecords);
    expect(flushed[1]).toEqual(backendRecords);

    // allNewRecords should be empty (records were flushed via callback)
    expect(result.allNewRecords).toHaveLength(0);

    // Stats should still be correct
    expect(result.stats.totalRecords).toBe(2);
    expect(result.stats.reposScanned).toBe(2);
  });

  it('calls onScanStateUpdated after each repo', async () => {
    mockScanRepo
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [makeRecord('Alice', 'frontend')],
          newHashes: ['h1'],
          commitCount: 1,
        }),
      )
      .mockResolvedValueOnce(
        makeScanResult({
          newRecords: [makeRecord('Bob', 'backend')],
          newHashes: ['h2'],
          commitCount: 2,
        }),
      );

    const states: unknown[] = [];
    const onScanStateUpdated = vi.fn(async (state: unknown) => {
      states.push(structuredClone(state));
    });

    await scanAllRepos(makeSampleConfig(), makeScanState(), {
      onScanStateUpdated,
    });

    // Called once per scanned repo
    expect(onScanStateUpdated).toHaveBeenCalledTimes(2);

    // After first call, only frontend should be in state
    const firstState = states[0] as { repos: Record<string, unknown> };
    expect(firstState.repos).toHaveProperty('frontend');
    expect(firstState.repos).not.toHaveProperty('backend');

    // After second call, both should be present
    const secondState = states[1] as { repos: Record<string, unknown> };
    expect(secondState.repos).toHaveProperty('frontend');
    expect(secondState.repos).toHaveProperty('backend');
  });

  it('passes chunkMonths through to scanRepo', async () => {
    mockScanRepo
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h1'] }))
      .mockResolvedValueOnce(makeScanResult({ newHashes: ['h2'] }));

    await scanAllRepos(makeSampleConfig(), makeScanState(), {
      chunkMonths: 6,
    });

    for (const call of mockScanRepo.mock.calls) {
      expect(call[1].chunkMonths).toBe(6);
    }
  });

  it('runs the PR proxy and rework passes after each repo scan and merges their records', async () => {
    const { getCurrentWeek } = await import('../aggregator/filters.js');
    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newRecords: [makeRecord('Alice', 'app')],
        newHashes: ['h1'],
        commitCount: 1,
        reworkInputs: [
          {
            hash: 'h1',
            authorEmail: 'a',
            authorName: 'A',
            authorDate: '2026-03-01T00:00:00Z',
            // Inside the analysable window (weeks_back x 2) — older inputs are
            // filtered out before runRework is called.
            week: getCurrentWeek(),
            files: [{ path: 'x', deletions: 1 }],
          },
        ],
      }),
    );
    mockRunPrProxy.mockResolvedValueOnce({
      records: [{ ...makeRecord('Alice', 'app'), commits: 0, prsMergedGit: 2, prSizes: [10, 20] }],
      newPrHashes: ['m1'],
      prCount: 2,
      branch: 'main',
    });
    mockRunRework.mockResolvedValueOnce({
      records: [{ ...makeRecord('Bob', 'app'), commits: 0, reworkLines: 4, reworkSelfLines: 1 }],
      commitsProcessed: 1,
      blames: 1,
    });

    const scanned: UserWeekRepoRecord[][] = [];
    const result = await scanAllRepos(makeConfig(), makeScanState(), {
      onRepoScanned: async (recs) => {
        scanned.push(recs);
      },
    });

    expect(mockRunRework).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ hash: 'h1' })]),
      expect.objectContaining({ repoName: 'app', windowDays: 21, concurrency: 3 }),
    );
    expect(mockRunPrProxy).toHaveBeenCalledWith(
      expect.objectContaining({ repoName: 'app', recentPrHashes: new Set() }),
    );
    expect(scanned).toHaveLength(1);
    const alice = scanned[0].find((r) => r.member === 'Alice')!;
    expect(alice.commits).toBe(makeRecord('Alice', 'app').commits); // scan record kept
    expect(alice.prsMergedGit).toBe(2); // proxy merged into it
    expect(alice.prSizes).toEqual([10, 20]);
    const bob = scanned[0].find((r) => r.member === 'Bob')!;
    expect(bob.commits).toBe(0);
    expect(bob.reworkLines).toBe(4);
    expect(result.updatedScanState.repos.app.recentPrHashes).toEqual(['m1']);
    expect(result.stats.totalPrs).toBe(2);
    expect(result.stats.totalReworkCommits).toBe(1);
  });

  it('bounds the rework inputs to the analysable window (weeks_back x 2, when weeks_back exceeds the 24-week floor)', async () => {
    const { getLastNWeeks, getCurrentWeek } = await import('../aggregator/filters.js');
    // weeks_back: 20 (> the 12-week floor) → window ∪ baseline = 40 weeks.
    const inWindow = getLastNWeeks(40, getCurrentWeek());
    const tooOld = getLastNWeeks(50, getCurrentWeek())[0]; // 49 weeks back

    const reworkInput = (hash: string, week: string) => ({
      hash,
      authorEmail: 'a@x',
      authorName: 'A',
      authorDate: '2026-03-01T00:00:00Z',
      week,
      files: [{ path: 'x', deletions: 1 }],
    });

    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newRecords: [makeRecord('Alice', 'app')],
        newHashes: ['h1'],
        commitCount: 1,
        reworkInputs: [
          reworkInput('recent', inWindow[inWindow.length - 1]),
          reworkInput('edge', inWindow[0]),
          reworkInput('ancient', tooOld),
        ],
      }),
    );
    mockRunRework.mockResolvedValueOnce({ records: [], commitsProcessed: 2, blames: 2 });

    await scanAllRepos(
      makeConfig({ settings: { ...DEFAULT_SETTINGS, weeks_back: 20 } }),
      makeScanState(),
    );

    const passed = mockRunRework.mock.calls[0][0] as Array<{ hash: string }>;
    expect(passed.map((i) => i.hash).sort()).toEqual(['edge', 'recent']);
  });

  it('bounds rework inputs to at least 24 weeks even when weeks_back is small', async () => {
    const { getLastNWeeks, getCurrentWeek } = await import('../aggregator/filters.js');
    // weeks_back: 4 → the Scorecard always reaches a 12-week window + 12-week
    // baseline regardless of weeks_back, so the bound must floor to 24 weeks.
    const recent = getLastNWeeks(24, getCurrentWeek());
    const inWindow = recent[0]; // oldest week inside the 24-week floor — must still be blamed
    const tooOld = getLastNWeeks(30, getCurrentWeek())[0]; // 29 weeks back — dropped

    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newRecords: [makeRecord('Alice', 'app')],
        newHashes: ['h1'],
        commitCount: 2,
        reworkInputs: [
          {
            hash: 'h1',
            authorEmail: 'a',
            authorName: 'A',
            authorDate: '2026-01-01T00:00:00Z',
            week: inWindow,
            files: [{ path: 'x', deletions: 1 }],
          },
          {
            hash: 'h2',
            authorEmail: 'a',
            authorName: 'A',
            authorDate: '2026-01-01T00:00:00Z',
            week: tooOld,
            files: [{ path: 'y', deletions: 1 }],
          },
        ],
      }),
    );
    mockRunRework.mockResolvedValueOnce({ records: [], commitsProcessed: 1, blames: 1 });

    await scanAllRepos(
      makeConfig({ settings: { ...DEFAULT_SETTINGS, weeks_back: 4 } }),
      makeScanState(),
    );

    const passed = mockRunRework.mock.calls[0][0] as Array<{ hash: string }>;
    expect(passed.map((i) => i.hash)).toEqual(['h1']);
  });

  it('skips the rework pass entirely when every input falls outside the window', async () => {
    const { getLastNWeeks, getCurrentWeek } = await import('../aggregator/filters.js');
    const tooOld = getLastNWeeks(40, getCurrentWeek())[0];

    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newHashes: ['h1'],
        reworkInputs: [
          {
            hash: 'ancient',
            authorEmail: 'a@x',
            authorName: 'A',
            authorDate: '2020-01-01T00:00:00Z',
            week: tooOld,
            files: [{ path: 'x', deletions: 1 }],
          },
        ],
      }),
    );

    await scanAllRepos(
      makeConfig({ settings: { ...DEFAULT_SETTINGS, weeks_back: 4 } }),
      makeScanState(),
    );

    expect(mockRunRework).not.toHaveBeenCalled();
  });

  it('announces the rework pass before running it', async () => {
    const { getLastNWeeks, getCurrentWeek } = await import('../aggregator/filters.js');
    const week = getLastNWeeks(1, getCurrentWeek())[0];

    mockScanRepo.mockResolvedValueOnce(
      makeScanResult({
        newHashes: ['h1'],
        reworkInputs: [
          {
            hash: 'r1',
            authorEmail: 'a@x',
            authorName: 'A',
            authorDate: '2026-03-01T00:00:00Z',
            week,
            files: [{ path: 'x', deletions: 1 }],
          },
        ],
      }),
    );

    const logged: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      logged.push(a.map(String).join(' '));
    });
    mockRunRework.mockImplementationOnce(async () => {
      // A long pass must already be visible by the time it starts.
      expect(logged.some((l) => l.includes('rework: blaming 1 commits'))).toBe(true);
      return { records: [], commitsProcessed: 1, blames: 1 };
    });

    await scanAllRepos(makeConfig(), makeScanState());
    consoleSpy.mockRestore();

    expect(logged.some((l) => l.includes('rework: blaming 1 commits'))).toBe(true);
    expect(logged.some((l) => l.includes('rework: 1 commits, 1 blames'))).toBe(true);
  });

  it('skips the rework pass when skipRework is set or rework_enabled is false', async () => {
    mockScanRepo.mockResolvedValue(makeScanResult({ newRecords: [makeRecord('Alice', 'app')] }));
    mockRunPrProxy.mockResolvedValue({ records: [], newPrHashes: [], prCount: 0, branch: 'main' });
    mockRunRework.mockClear();

    await scanAllRepos(makeConfig(), makeScanState(), { skipRework: true });
    expect(mockRunRework).not.toHaveBeenCalled();

    await scanAllRepos(
      makeConfig({ settings: { ...DEFAULT_SETTINGS, rework_enabled: false } }),
      makeScanState(),
      {},
    );
    expect(mockRunRework).not.toHaveBeenCalled();
    expect(mockScanRepo).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ collectRework: false }),
    );
  });

  it('reuses the stored recentPrHashes cursor and rotates it', async () => {
    mockScanRepo.mockResolvedValue(makeScanResult({}));
    mockRunPrProxy.mockResolvedValue({
      records: [],
      newPrHashes: ['m2'],
      prCount: 1,
      branch: 'main',
    });
    mockRunRework.mockResolvedValue({ records: [], commitsProcessed: 0, blames: 0 });
    const state = makeScanState({
      app: {
        lastHash: 'x',
        lastScanDate: '2020-01-01T00:00:00Z',
        recentHashes: [],
        recordCount: 0,
        recentPrHashes: ['m1'],
      },
    });
    const result = await scanAllRepos(makeConfig(), state, { forceScan: true });
    expect(mockRunPrProxy).toHaveBeenCalledWith(
      expect.objectContaining({ recentPrHashes: new Set(['m1']) }),
    );
    expect(result.updatedScanState.repos.app.recentPrHashes).toEqual(['m2', 'm1']);
  });
});
