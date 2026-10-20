/**
 * The engine must never persist a stale author registry (#115).
 *
 * A TUI assignment replaced only `ctx.authorRegistry`; the engine kept its startup
 * snapshot and, on the next rescan, merged discovered authors into that snapshot and
 * saved it, reverting the assignment in SQLite. The same lost update happens across
 * processes (`scan --watch` vs the TUI), so the merge must start from what is in the
 * store *now*, not from memory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorRegistry, Config, ScanState } from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';

vi.mock('../store/sqlite-store.js', () => ({
  deleteRecordsForRepo: vi.fn(),
  deleteScanStateForRepo: vi.fn(),
  getMetaTimestamps: vi.fn(() => ({})),
  getSQLitePath: vi.fn(() => '/tmp/does-not-exist.db'),
  getStoreStatsSQLFull: vi.fn(() => ({})),
  hasEnrichment: vi.fn(() => false),
  listDataFiles: vi.fn(() => []),
  loadAuthorRegistrySQL: vi.fn(() => ({ version: 1, authors: {} })),
  loadEnrichmentsSQL: vi.fn(() => ({ version: 1, lastUpdated: '', enrichments: {} })),
  loadScanStateSQL: vi.fn(() => ({ version: 1, repos: {} })),
  pruneRecordsSQL: vi.fn(() => 0),
  queryRecords: vi.fn(() => []),
  queryRollup: vi.fn(() => new Map()),
  reattributeRecordsSQL: vi.fn(),
  resetAllData: vi.fn(() => []),
  saveAuthorRegistrySQL: vi.fn(),
  saveEnrichmentBatchSQL: vi.fn(),
  saveScanStateSQL: vi.fn(),
  subtractRepoFromAuthorCounts: vi.fn(),
  updateRepoScanStateSQL: vi.fn(),
  acquireScanLock: vi.fn(),
  releaseScanLock: vi.fn(),
  ScanInProgressError: class ScanInProgressError extends Error {
    constructor(
      public readonly pid: number,
      public readonly startedAt: string,
    ) {
      super(`a scan is already in progress (pid ${pid}, since ${startedAt})`);
    }
  },
  upsertRecords: vi.fn(),
}));

vi.mock('../store/db-watcher.js', () => ({
  DbWatcher: class {
    start = vi.fn();
    close = vi.fn();
  },
}));

vi.mock('../collector/index.js', () => ({
  scanAllRepos: vi.fn(),
}));

import { scanAllRepos } from '../collector/index.js';
import { GitRadarEngine } from '../engine/gitradar-engine.js';
import {
  acquireScanLock,
  loadAuthorRegistrySQL,
  releaseScanLock,
  saveAuthorRegistrySQL,
  saveScanStateSQL,
  updateRepoScanStateSQL,
} from '../store/sqlite-store.js';

const mockScanAllRepos = vi.mocked(scanAllRepos);
const mockLoadRegistry = vi.mocked(loadAuthorRegistrySQL);
const mockSaveRegistry = vi.mocked(saveAuthorRegistrySQL);

const ALICE = 'alice@example.com';

function registry(org?: string): AuthorRegistry {
  return {
    version: 1,
    authors: {
      [ALICE]: {
        email: ALICE,
        name: 'Alice',
        org,
        team: org ? 'FE' : undefined,
        firstSeen: '2026-01-01',
        lastSeen: '2026-01-01',
        reposSeenIn: ['alpha'],
        commitCount: 1,
      },
    },
  };
}

function makeEngine(): GitRadarEngine {
  const engine = new GitRadarEngine();
  engine.config = {
    repos: [{ path: '/repos/alpha', name: 'alpha', group: 'default' }],
    orgs: [],
    groups: {},
    tags: {},
    settings: { ...DEFAULT_SETTINGS },
  } as unknown as Config;
  engine.scanState = { version: 1, repos: {} } as ScanState;
  // The startup snapshot: Alice unassigned. Meanwhile the store (another process, or the
  // TUI's own assignment) says Alice is in Acme.
  engine.authorRegistry = registry(undefined);
  mockLoadRegistry.mockReturnValue(registry('Acme'));
  return engine;
}

/** A collector that reports Alice as discovered and records what registry it was handed. */
function discoveringCollector(seen: { registry?: AuthorRegistry }) {
  return async (_config: Config, scanState: ScanState, options?: Record<string, any>) => {
    seen.registry = options?.authorRegistry;
    await options?.onAuthorsDiscovered?.([
      { email: ALICE, name: 'Alice', repoName: 'alpha', commitCount: 3, lastDate: '2026-02-01' },
    ]);
    return {
      allNewRecords: [],
      updatedScanState: scanState,
      discoveredAuthors: [],
      stats: {
        totalCommits: 3,
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

describe('author registry ownership (#115)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('rescanRepo merges discovered authors into the registry as stored, keeping the assignment', async () => {
    const engine = makeEngine();
    const seen: { registry?: AuthorRegistry } = {};
    mockScanAllRepos.mockImplementation(discoveringCollector(seen) as never);

    await engine.rescanRepo('alpha');

    expect(seen.registry?.authors[ALICE].org).toBe('Acme'); // records attributed with the live registry
    expect(mockSaveRegistry).toHaveBeenCalledTimes(1);
    const saved = mockSaveRegistry.mock.calls[0][0];
    expect(saved.authors[ALICE].org).toBe('Acme');
    expect(saved.authors[ALICE].commitCount).toBe(4); // merged on top of the stored entry
    expect(engine.authorRegistry?.authors[ALICE].org).toBe('Acme');
  });

  it('scan merges discovered authors into the registry as stored, keeping the assignment', async () => {
    const engine = makeEngine();
    const seen: { registry?: AuthorRegistry } = {};
    mockScanAllRepos.mockImplementation(discoveringCollector(seen) as never);

    await engine.scan({});

    const saved = mockSaveRegistry.mock.calls[0][0];
    expect(saved.authors[ALICE].org).toBe('Acme');
  });

  it('a TUI save through onSaveAuthorRegistry becomes the engine registry', async () => {
    const engine = makeEngine();
    const ctx = await engine.buildViewContext();
    const assigned = registry('Acme');
    await ctx.onSaveAuthorRegistry?.(assigned);
    expect(mockSaveRegistry).toHaveBeenCalledWith(assigned);
    expect(engine.authorRegistry).toBe(assigned);
    engine.close();
  });
});

describe('scan exit status (#112)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('sets a non-zero exit code when any repo failed to scan', async () => {
    const engine = makeEngine();
    mockScanAllRepos.mockResolvedValue({
      allNewRecords: [],
      updatedScanState: { version: 1, repos: {} },
      discoveredAuthors: [],
      stats: {
        totalCommits: 0,
        totalRecords: 0,
        reposScanned: 0,
        reposSkipped: 0,
        reposMissing: 0,
        reposFailed: 1,
        totalPrs: 0,
        totalReworkCommits: 0,
      },
    } as never);
    await engine.scan({});
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});

describe('scan lock and per-repo cursors (#111)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  const okResult = (state: ScanState) => ({
    allNewRecords: [],
    updatedScanState: state,
    discoveredAuthors: [],
    stats: {
      totalCommits: 0,
      totalRecords: 0,
      reposScanned: 1,
      reposSkipped: 0,
      reposMissing: 0,
      reposFailed: 0,
      totalPrs: 0,
      totalReworkCommits: 0,
    },
  });

  it('takes the lock before scanning and releases it afterwards, even when the scan throws', async () => {
    const engine = makeEngine();
    mockScanAllRepos.mockRejectedValueOnce(new Error('boom'));
    await expect(engine.scan({})).rejects.toThrow('boom');
    expect(vi.mocked(acquireScanLock)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(releaseScanLock)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(acquireScanLock).mock.invocationCallOrder[0]).toBeLessThan(
      mockScanAllRepos.mock.invocationCallOrder[0],
    );
  });

  it('skips the scan with a message and returns false when another scan holds the lock', async () => {
    const engine = makeEngine();
    const { ScanInProgressError } = await import('../store/sqlite-store.js');
    vi.mocked(acquireScanLock).mockImplementationOnce(() => {
      throw new ScanInProgressError(4242, '2026-10-20T10:00:00.000Z');
    });
    const scanned = await engine.scan({});
    expect(scanned).toBe(false);
    expect(mockScanAllRepos).not.toHaveBeenCalled();
    expect(vi.mocked(releaseScanLock)).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toMatch(
      /scan .*in progress.*pid 4242/i,
    );
  });

  it('returns true after a scan it ran', async () => {
    const engine = makeEngine();
    mockScanAllRepos.mockResolvedValueOnce(okResult({ version: 1, repos: {} }) as never);
    expect(await engine.scan({})).toBe(true);
  });

  it('persists only the scanned repo cursor instead of rewriting every repo from the snapshot', async () => {
    const engine = makeEngine();
    engine.scanState = {
      version: 1,
      repos: {
        other: {
          lastHash: 'o',
          lastScanDate: '2026-01-01T00:00:00.000Z',
          recentHashes: [],
          recordCount: 1,
        },
      },
    };
    mockScanAllRepos.mockImplementation((async (
      _c: unknown,
      state: ScanState,
      options?: Record<string, any>,
    ) => {
      const updated: ScanState = {
        ...state,
        repos: {
          ...state.repos,
          alpha: {
            lastHash: 'a',
            lastScanDate: '2026-02-01T00:00:00.000Z',
            recentHashes: ['a'],
            recordCount: 2,
          },
        },
      };
      await options?.onScanStateUpdated?.(updated, 'alpha');
      return okResult(updated);
    }) as never);

    await engine.scan({});

    expect(vi.mocked(saveScanStateSQL)).not.toHaveBeenCalled();
    expect(vi.mocked(updateRepoScanStateSQL)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateRepoScanStateSQL)).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({ lastHash: 'a' }),
    );
    expect(engine.scanState?.repos.alpha?.lastHash).toBe('a');
  });
});
