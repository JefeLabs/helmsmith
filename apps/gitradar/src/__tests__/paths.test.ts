import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock os.homedir before importing the module
const MOCK_HOME = '/mock/home';

vi.mock('node:os', () => ({
  homedir: () => MOCK_HOME,
}));

// Mock fs/promises for ensureDataDir
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
}));

// Import after mocks are set up
const { expandTilde, getConfigDir, getDataDir, getConfigPath, ensureDataDir } = await import(
  '../store/paths.js'
);

const { mkdir } = await import('node:fs/promises');

// ── GITRADAR_HOME override ──────────────────────────────────────────────────

describe('GITRADAR_HOME override', () => {
  const original = process.env.GITRADAR_HOME;

  afterEach(() => {
    if (original === undefined) delete process.env.GITRADAR_HOME;
    else process.env.GITRADAR_HOME = original;
  });

  it('uses ~/.agentx/gitradar when GITRADAR_HOME is unset', () => {
    delete process.env.GITRADAR_HOME;
    expect(getConfigDir()).toBe(join(MOCK_HOME, '.agentx', 'gitradar'));
  });

  it('redirects every path under GITRADAR_HOME when set (tests, sandboxes, CI)', () => {
    process.env.GITRADAR_HOME = '/sandbox/gitradar';
    expect(getConfigDir()).toBe('/sandbox/gitradar');
    expect(getDataDir()).toBe(join('/sandbox/gitradar', 'data'));
    expect(getConfigPath()).toBe(join('/sandbox/gitradar', 'config.yml'));
  });

  it('ignores an empty GITRADAR_HOME', () => {
    process.env.GITRADAR_HOME = '';
    expect(getConfigDir()).toBe(join(MOCK_HOME, '.agentx', 'gitradar'));
  });
});

// ── expandTilde ─────────────────────────────────────────────────────────────

describe('expandTilde', () => {
  it('expands ~ alone to home directory', () => {
    expect(expandTilde('~')).toBe(MOCK_HOME);
  });

  it('expands ~/path to home + path', () => {
    expect(expandTilde('~/code/project')).toBe(join(MOCK_HOME, 'code', 'project'));
  });

  it('does not expand paths without leading tilde', () => {
    expect(expandTilde('/absolute/path')).toBe('/absolute/path');
  });

  it('does not expand tilde in the middle of a path', () => {
    expect(expandTilde('/some/~/path')).toBe('/some/~/path');
  });

  it('handles ~/  (tilde + slash only)', () => {
    expect(expandTilde('~/')).toBe(join(MOCK_HOME, ''));
  });

  it('returns relative paths unchanged', () => {
    expect(expandTilde('relative/path')).toBe('relative/path');
  });
});

// ── Path getters ────────────────────────────────────────────────────────────

describe('getConfigDir', () => {
  it('returns ~/.agentx/gitradar/', () => {
    expect(getConfigDir()).toBe(join(MOCK_HOME, '.agentx', 'gitradar'));
  });
});

describe('getDataDir', () => {
  it('returns ~/.agentx/gitradar/data/', () => {
    expect(getDataDir()).toBe(join(MOCK_HOME, '.agentx', 'gitradar', 'data'));
  });
});

describe('getConfigPath', () => {
  it('returns ~/.agentx/gitradar/config.yml', () => {
    expect(getConfigPath()).toBe(join(MOCK_HOME, '.agentx', 'gitradar', 'config.yml'));
  });
});

// ── ensureDataDir ───────────────────────────────────────────────────────────

describe('ensureDataDir', () => {
  beforeEach(() => {
    vi.mocked(mkdir).mockClear();
  });

  it('creates the data directory recursively', async () => {
    await ensureDataDir();
    expect(mkdir).toHaveBeenCalledWith(join(MOCK_HOME, '.agentx', 'gitradar', 'data'), {
      recursive: true,
    });
  });

  it('calls mkdir exactly once', async () => {
    await ensureDataDir();
    expect(mkdir).toHaveBeenCalledTimes(1);
  });
});
