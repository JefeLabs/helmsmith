import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigNotFoundError, loadConfig, saveConfig } from '../config/loader.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
  copyFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock store/paths to control getConfigPath and expandTilde
vi.mock('../store/paths.js', () => ({
  getConfigPath: vi.fn(() => '/home/user/.agentx/gitradar/config.yml'),
  expandTilde: vi.fn((p: string) => {
    if (p === '~') return '/home/user';
    if (p.startsWith('~/')) return `/home/user/${p.slice(2)}`;
    return p;
  }),
}));

import { access, copyFile, readFile, rename, writeFile } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);
const mockAccess = vi.mocked(access);
const mockCopyFile = vi.mocked(copyFile);
const mockRename = vi.mocked(rename);
const mockWriteFile = vi.mocked(writeFile);

const validYaml = `
orgs:
  - name: TeamA
    type: core
    teams:
      - name: Platform
        tag: infrastructure
        members:
          - name: Alice
            email: alice@example.com
`;

const yamlWithRepos = `
repos:
  - path: /x
orgs: []
`;

const invalidYaml = `
orgs:
  - path: [[[invalid yaml
  name: broken
    indentation: wrong
`;

const schemaInvalidYaml = `
orgs:
  - name: TeamA
    type: invalid_type
    teams: []
`;

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Valid config ────────────────────────────────────────────────────────────

  describe('valid configuration', () => {
    it('loads and parses a valid YAML config', async () => {
      mockReadFile.mockResolvedValue(validYaml);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await loadConfig('/path/to/config.yml');

      expect(config.repos).toEqual([]);
      expect(config.orgs).toHaveLength(1);
      expect(config.orgs[0].name).toBe('TeamA');
      expect(config.orgs[0].type).toBe('core');
    });

    it('uses default config path when none provided', async () => {
      mockReadFile.mockResolvedValue(validYaml);

      await loadConfig();

      expect(mockReadFile).toHaveBeenCalledWith('/home/user/.agentx/gitradar/config.yml', 'utf-8');
    });

    it('applies Zod defaults for optional fields', async () => {
      const minimalYaml = `
orgs:
  - name: Org
    type: core
    teams:
      - name: Team
        members:
          - name: Bob
`;
      mockReadFile.mockResolvedValue(minimalYaml);

      const config = await loadConfig('/some/config.yml');

      expect(config.repos).toEqual([]);
      expect(config.settings.weeks_back).toBe(12);
      expect(config.settings.staleness_minutes).toBe(60);
      expect(config.groups).toEqual({});
      expect(config.tags).toEqual({});
    });
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it("throws 'Config file not found' for missing file", async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      await expect(loadConfig('/nonexistent/config.yml')).rejects.toThrow(
        'Config file not found at /nonexistent/config.yml',
      );
    });

    it("throws 'Invalid YAML' for malformed YAML", async () => {
      mockReadFile.mockResolvedValue(invalidYaml);

      await expect(loadConfig('/path/to/bad.yml')).rejects.toThrow('Invalid YAML');
    });

    it('throws descriptive error for schema violations', async () => {
      mockReadFile.mockResolvedValue(schemaInvalidYaml);

      await expect(loadConfig('/path/to/invalid.yml')).rejects.toThrow('Config validation failed:');
    });
  });

  // ── repos: is ignored ───────────────────────────────────────────────────────

  describe('config.yml "repos:" is ignored', () => {
    it('ignores config.yml repos: with a one-line warning', async () => {
      mockReadFile.mockResolvedValue(yamlWithRepos);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const cfg = await loadConfig('/path/to/config.yml');

      expect(cfg.repos).toEqual([]);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/"repos:" is ignored/);
    });

    it('does not warn when repos: is absent', async () => {
      mockReadFile.mockResolvedValue(validYaml);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await loadConfig('/path/to/config.yml');

      expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn when repos: is an empty array', async () => {
      mockReadFile.mockResolvedValue('repos: []\norgs: []\n');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const cfg = await loadConfig('/path/to/config.yml');

      expect(cfg.repos).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

// ── Missing vs invalid, and saving (#113) ──────────────────────────────────

const COMMENTED = `# Team config — keep in sync with HR
orgs:
  - name: Acme   # core org
    type: core
    teams:
      - name: Platform
        tag: infra
        members: []
settings:
  weeks_back: 8  # two months
`;

const CONFIG_PATH = '/home/user/.agentx/gitradar/config.yml';

describe('loadConfig distinguishes missing from invalid (#113)', () => {
  it('throws ConfigNotFoundError for a missing file', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    await expect(loadConfig()).rejects.toBeInstanceOf(ConfigNotFoundError);
  });

  it('throws a plain Error (not ConfigNotFoundError) for an invalid file', async () => {
    mockReadFile.mockResolvedValue('orgs:\n  - name: X\n    type: Core\n    teams: []\n');
    const err = await loadConfig().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ConfigNotFoundError);
    expect(err.message).toMatch(/Config validation failed/);
  });
});

describe('saveConfig (#113)', () => {
  beforeEach(() => vi.clearAllMocks());

  const acme = {
    name: 'Acme',
    type: 'core' as const,
    teams: [{ name: 'Platform', tag: 'infra', members: [] }],
  };
  const beta = {
    name: 'Beta',
    type: 'consultant' as const,
    teams: [{ name: 'T', tag: 'default', members: [] }],
  };

  function written(): string {
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    return String(mockWriteFile.mock.calls[0][1]);
  }

  it('appends an org while keeping comments and the existing org untouched', async () => {
    mockReadFile.mockResolvedValue(COMMENTED);
    mockAccess.mockResolvedValue(undefined);
    const loaded = await loadConfig();
    await saveConfig(undefined, { orgs: [...loaded.orgs, beta] });

    const out = written();
    expect(out).toContain('# Team config — keep in sync with HR');
    expect(out).toContain('# core org');
    expect(out).toContain('# two months');
    expect(out).toContain('name: Acme');
    expect(out).toContain('tag: infra');
    expect(out).toContain('weeks_back: 8');
    expect(out).toContain('name: Beta');
    expect(out).not.toContain('aliases');
    expect(out.indexOf('name: Acme')).toBeLessThan(out.indexOf('name: Beta'));
  });

  it('refuses to write when the existing file is not valid YAML', async () => {
    mockReadFile.mockResolvedValue('orgs: [unclosed\n');
    mockAccess.mockResolvedValue(undefined);
    await expect(saveConfig(undefined, { orgs: [acme] })).rejects.toThrow(/not valid YAML/);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
  });

  it('backs up the existing file and writes through a temp file + rename', async () => {
    mockReadFile.mockResolvedValue(COMMENTED);
    mockAccess.mockResolvedValue(undefined);
    await saveConfig(undefined, { orgs: [acme, beta] });
    expect(mockCopyFile).toHaveBeenCalledWith(CONFIG_PATH, `${CONFIG_PATH}.bak`);
    const tmp = String(mockWriteFile.mock.calls[0][0]);
    expect(tmp).not.toBe(CONFIG_PATH);
    expect(mockRename).toHaveBeenCalledWith(tmp, CONFIG_PATH);
  });

  it('creates the file when it is missing, with no backup', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    await saveConfig(undefined, { orgs: [acme] });
    expect(mockCopyFile).not.toHaveBeenCalled();
    expect(written()).toContain('name: Acme');
    expect(mockRename).toHaveBeenCalledTimes(1);
  });
});
