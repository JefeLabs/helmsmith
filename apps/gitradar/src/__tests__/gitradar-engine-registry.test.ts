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
import { loadAuthorRegistrySQL, saveAuthorRegistrySQL } from '../store/sqlite-store.js';

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
