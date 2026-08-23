import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/loader.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  access: vi.fn(),
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

import { readFile } from 'node:fs/promises';

const mockReadFile = vi.mocked(readFile);

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
