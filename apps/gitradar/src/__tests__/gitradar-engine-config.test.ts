/**
 * When config.yml fails to load, the TUI must not be able to save over it (#113):
 * `onAddOrg` would otherwise write the empty in-memory org list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  pruneRecordsSQL: vi.fn(),
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

vi.mock('../config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/loader.js')>();
  return { ...actual, loadConfig: vi.fn(), saveConfig: vi.fn() };
});

vi.mock('../config/repos-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/repos-registry.js')>();
  return {
    ...actual,
    loadAllRegistries: vi.fn(async () => [
      {
        type: 'global',
        path: '/home/user/.agentx/repos.yml',
        registry: { workspaces: { default: { repos: [] } }, groups: {}, tags: {} },
      },
    ]),
  };
});

import { loadConfig, saveConfig } from '../config/loader.js';
import { GitRadarEngine } from '../engine/gitradar-engine.js';

const mockLoad = vi.mocked(loadConfig);
const mockSave = vi.mocked(saveConfig);

describe('engine with an invalid config.yml (#113)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('warns with the validation issues at startup and refuses to save from the TUI', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => {
      errors.push(a.join(' '));
    });
    mockLoad.mockRejectedValue(
      new Error("Config validation failed:\n  - 'orgs.0.type': Invalid enum value"),
    );

    const engine = new GitRadarEngine();
    const ok = await engine.resolveWorkspace({ workspace: 'default' });
    expect(ok).toBe(true);
    expect(errors.join('\n')).toContain("'orgs.0.type'");

    const ctx = await engine.buildViewContext();
    await expect(ctx.onAddOrg?.({ name: 'Zed', type: 'core', teams: [] })).rejects.toThrow(
      /config\.yml/,
    );
    expect(mockSave).not.toHaveBeenCalled();
    engine.close();
  });

  it('does not warn when the config is simply missing', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => {
      errors.push(a.join(' '));
    });
    const { ConfigNotFoundError } = await import('../config/loader.js');
    mockLoad.mockRejectedValue(new ConfigNotFoundError('Config file not found at /x'));

    const engine = new GitRadarEngine();
    await engine.resolveWorkspace({ workspace: 'default' });
    expect(errors).toEqual([]);

    const ctx = await engine.buildViewContext();
    await ctx.onAddOrg?.({ name: 'Zed', type: 'core', teams: [] });
    expect(mockSave).toHaveBeenCalledTimes(1);
    engine.close();
  });
});
