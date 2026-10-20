/**
 * `gitradar --reset` (#96): must work on a corrupt DB (so it never opens it),
 * must ask before destroying data, and must exit non-zero when nothing was reset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../store/sqlite-store.js', () => ({
  deleteRecordsForRepo: vi.fn(),
  deleteScanStateForRepo: vi.fn(),
  getMetaTimestamps: vi.fn(() => ({})),
  getSQLitePath: vi.fn(() => '/tmp/x/data/gitradar.db'),
  getStoreStatsSQLFull: vi.fn(() => ({})),
  hasEnrichment: vi.fn(() => false),
  listDataFiles: vi.fn(() => []),
  loadAuthorRegistrySQL: vi.fn(() => ({ version: 1, authors: {} })),
  loadEnrichmentsSQL: vi.fn(() => ({ version: 1, lastUpdated: '', enrichments: {} })),
  loadScanStateSQL: vi.fn(() => ({ version: 1, repos: {} })),
  pruneRecordsSQL: vi.fn(),
  queryRecords: vi.fn(() => []),
  queryRollup: vi.fn(() => new Map()),
  resetAllData: vi.fn(() => []),
  saveAuthorRegistrySQL: vi.fn(),
  saveEnrichmentBatchSQL: vi.fn(),
  saveScanStateSQL: vi.fn(),
  upsertRecords: vi.fn(),
}));

vi.mock('../ui/keypress.js', () => ({
  readKey: vi.fn(),
}));

import { GitRadarEngine } from '../engine/gitradar-engine.js';
import { listDataFiles, resetAllData } from '../store/sqlite-store.js';
import { readKey } from '../ui/keypress.js';

const mockList = vi.mocked(listDataFiles);
const mockReset = vi.mocked(resetAllData);
const mockReadKey = vi.mocked(readKey);
const DB = '/tmp/x/data/gitradar.db';

describe('GitRadarEngine.handleReset (#96)', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let isTTY: boolean | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    isTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true });
    process.exitCode = undefined;
  });

  const output = () => log.mock.calls.flat().join('\n');

  it('says there is no data and exits 1 when no data files exist, without prompting', async () => {
    mockList.mockReturnValue([]);
    await new GitRadarEngine().handleReset({ yes: true });
    expect(mockReset).not.toHaveBeenCalled();
    expect(mockReadKey).not.toHaveBeenCalled();
    expect(output()).toMatch(/no data/i);
    expect(output()).toMatch(/gitradar scan/);
    expect(process.exitCode).toBe(1);
  });

  it('moves the files aside with --yes and reports what it moved', async () => {
    mockList.mockReturnValue([DB, `${DB}-wal`]);
    mockReset.mockReturnValue([`${DB}.bak-20261020T010203Z`, `${DB}-wal.bak-20261020T010203Z`]);
    await new GitRadarEngine().handleReset({ yes: true });
    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(mockReadKey).not.toHaveBeenCalled();
    expect(output()).toContain(`${DB}.bak-20261020T010203Z`);
    expect(process.exitCode).toBeUndefined();
  });

  it('asks y/N on a TTY and cancels with exit 1 on anything but y', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockList.mockReturnValue([DB]);
    mockReadKey.mockResolvedValue({ name: 'n', ctrl: false, raw: 'n' });
    await new GitRadarEngine().handleReset({});
    expect(mockReadKey).toHaveBeenCalledTimes(1);
    expect(mockReset).not.toHaveBeenCalled();
    expect(output()).toMatch(/\(y\/N\)/);
    expect(process.exitCode).toBe(1);
  });

  it('proceeds on y', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    mockList.mockReturnValue([DB]);
    mockReset.mockReturnValue([`${DB}.bak-20261020T010203Z`]);
    mockReadKey.mockResolvedValue({ name: 'y', ctrl: false, raw: 'y' });
    await new GitRadarEngine().handleReset({});
    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('refuses without --yes when stdin is not a terminal', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
    mockList.mockReturnValue([DB]);
    await new GitRadarEngine().handleReset({});
    expect(mockReadKey).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
