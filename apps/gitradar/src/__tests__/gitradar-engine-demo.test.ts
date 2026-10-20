/**
 * Demo mode must not touch the real store or config (#93): no DB open, no watcher, and
 * no persistence callbacks for the Manage tab to call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDemoData } from '../demo.js';

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

const watcherCtor = vi.fn();
vi.mock('../store/db-watcher.js', () => ({
  DbWatcher: class {
    constructor() {
      watcherCtor();
    }
    start = vi.fn();
    close = vi.fn();
  },
}));

import { GitRadarEngine } from '../engine/gitradar-engine.js';
import * as store from '../store/sqlite-store.js';

describe('GitRadarEngine.buildDemoViewContext (#93)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a context from the in-memory demo data without opening the store', () => {
    const demo = generateDemoData(4);
    const engine = new GitRadarEngine();
    engine.config = demo.config;
    engine.records = demo.records;

    const ctx = engine.buildDemoViewContext();

    expect(ctx.config).toBe(demo.config);
    expect(ctx.records).toHaveLength(demo.records.length);
    expect(ctx.currentWeek).toMatch(/^\d{4}-W\d{2}$/);
    for (const fn of Object.values(store)) {
      if (typeof fn === 'function' && 'mock' in fn) expect(fn).not.toHaveBeenCalled();
    }
    expect(watcherCtor).not.toHaveBeenCalled();
  });

  it('has no persistence callbacks, so the Manage tab cannot save anything', () => {
    const demo = generateDemoData(4);
    const engine = new GitRadarEngine();
    engine.config = demo.config;
    engine.records = demo.records;

    const ctx = engine.buildDemoViewContext();

    for (const key of [
      'onAddOrg',
      'onSaveAuthorRegistry',
      'onReattributeRecords',
      'onScanRepo',
      'onScanDir',
      'onRemoveRepo',
      'onRefreshData',
      'createRefreshSignal',
      'queryRollup',
    ] as const) {
      expect(ctx[key], key).toBeUndefined();
    }
  });
});
