/**
 * A failed rescan must not be able to resurrect the cursor it just deleted.
 *
 * `rescanRepo` deletes the repo's records and its `scan_state` row through
 * `onRepoReset` before the scan runs. If the scan then throws, the in-memory
 * `this.scanState` still holds the repo's pre-delete entry — and because
 * `onScanStateUpdated` persists the *whole* state, the next successful rescan
 * writes that stale entry back. The repo would then look freshly scanned with
 * zero records, and an ordinary scan would skip it as fresh or resume from the
 * stale cursor — recoverable only with `--force-scan` or `--reset`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, ScanState } from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

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
  queryRollup: vi.fn(() => new Map()),
  resetAllData: vi.fn(),
  saveAuthorRegistrySQL: vi.fn(),
  saveEnrichmentBatchSQL: vi.fn(),
  saveScanStateSQL: vi.fn(),
  upsertRecords: vi.fn(),
}));

vi.mock('../collector/index.js', () => ({
  scanAllRepos: vi.fn(),
}));

import { scanAllRepos } from '../collector/index.js';
import { GitRadarEngine } from '../engine/gitradar-engine.js';
import { deleteScanStateForRepo, saveScanStateSQL } from '../store/sqlite-store.js';

const mockScanAllRepos = vi.mocked(scanAllRepos);
const mockSaveScanState = vi.mocked(saveScanStateSQL);
const mockDeleteScanState = vi.mocked(deleteScanStateForRepo);

// ── Fixtures ─────────────────────────────────────────────────────────────────

function repoState(hash: string) {
  return {
    lastHash: hash,
    lastScanDate: '2026-08-01T00:00:00.000Z',
    recentHashes: [hash],
    recordCount: 42,
  };
}

function makeConfig(): Config {
  return {
    repos: [
      { path: '/repos/alpha', name: 'alpha', group: 'default' },
      { path: '/repos/beta', name: 'beta', group: 'default' },
    ],
    orgs: [],
    groups: {},
    tags: {},
    settings: { ...DEFAULT_SETTINGS },
  } as unknown as Config;
}

function makeEngine(): GitRadarEngine {
  const engine = new GitRadarEngine();
  engine.config = makeConfig();
  engine.scanState = {
    version: 1,
    repos: { alpha: repoState('aaa111'), beta: repoState('bbb222') },
  } as ScanState;
  return engine;
}

/**
 * Stand-in for the collector: it runs `onRepoReset` (the forced-scan delete),
 * then either throws or persists the state it was handed plus a fresh cursor
 * for the repo it scanned — exactly what the real collector does.
 */
function collectorThatFailsFor(failingRepo: string) {
  return async (config: Config, scanState: ScanState, options?: Record<string, any>) => {
    const name = config.repos[0].name as string;
    await options?.onRepoReset?.(name);
    if (name === failingRepo) throw new Error(`git log failed for ${name}`);

    const updated: ScanState = {
      version: 1,
      repos: { ...scanState.repos, [name]: repoState(`fresh-${name}`) },
    };
    await options?.onScanStateUpdated?.(updated);
    return {
      allNewRecords: [],
      updatedScanState: updated,
      discoveredAuthors: [],
      stats: {
        totalCommits: 0,
        totalRecords: 0,
        reposScanned: 1,
        reposSkipped: 0,
        reposMissing: 0,
        totalPrs: 0,
        totalReworkCommits: 0,
      },
    };
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GitRadarEngine.rescanRepo — a failed rescan cannot resurrect a deleted cursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops the repo from the in-memory state as soon as its cursor row is deleted', async () => {
    const engine = makeEngine();
    mockScanAllRepos.mockImplementation(collectorThatFailsFor('alpha') as never);

    await expect(engine.rescanRepo('alpha')).rejects.toThrow(/git log failed/);

    expect(mockDeleteScanState).toHaveBeenCalledWith('alpha');
    expect(engine.scanState?.repos.alpha).toBeUndefined();
    // beta was untouched.
    expect(engine.scanState?.repos.beta?.lastHash).toBe('bbb222');
  });

  it('a later successful rescan does not write the failed repo back into scan_state', async () => {
    const engine = makeEngine();
    mockScanAllRepos.mockImplementation(collectorThatFailsFor('alpha') as never);

    await expect(engine.rescanRepo('alpha')).rejects.toThrow(/git log failed/);
    await engine.rescanRepo('beta');

    const saved = mockSaveScanState.mock.calls.at(-1)?.[0] as ScanState;
    expect(Object.keys(saved.repos).sort()).toEqual(['beta']);
    expect(saved.repos.alpha).toBeUndefined();
    expect(engine.scanState?.repos.alpha).toBeUndefined();
  });
});
