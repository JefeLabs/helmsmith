/**
 * `org add`, `org add-team` and `org list` must never write after a failed config load,
 * and must say what is wrong with the file (#113).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/loader.js')>();
  return { ...actual, loadConfig: vi.fn(), saveConfig: vi.fn() };
});

import { addOrg, addTeamToOrg } from '../commands/add-org.js';
import { listOrgs } from '../commands/list-orgs.js';
import { ConfigNotFoundError, loadConfig, saveConfig } from '../config/loader.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';

const mockLoad = vi.mocked(loadConfig);
const mockSave = vi.mocked(saveConfig);
const INVALID = new Error("Config validation failed:\n  - 'orgs.0.type': Invalid enum value");

describe('config commands after a failed load (#113)', () => {
  let out: string[];
  let err: string[];
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => {
      out.push(a.join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a) => {
      err.push(a.join(' '));
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('org add refuses to write over an invalid config and prints the issues', async () => {
    mockLoad.mockRejectedValue(INVALID);
    await addOrg({ name: 'Gamma', type: 'core', team: 'T' });
    expect(mockSave).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain("'orgs.0.type'");
  });

  it('org add starts a fresh config when the file is missing', async () => {
    mockLoad.mockRejectedValue(new ConfigNotFoundError('Config file not found at /x'));
    await addOrg({ name: 'Gamma', type: 'core', team: 'T' });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][1].orgs?.map((o) => o.name)).toEqual(['Gamma']);
    expect(process.exitCode).toBeUndefined();
  });

  it('org add-team says why the config failed to load', async () => {
    mockLoad.mockRejectedValue(INVALID);
    await addTeamToOrg({ org: 'Acme', team: 'T' });
    expect(mockSave).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain("'orgs.0.type'");
  });

  it('org list exits 1 with the issues on an invalid config', async () => {
    mockLoad.mockRejectedValue(INVALID);
    await listOrgs({});
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain("'orgs.0.type'");
  });

  it('org list points at commands that exist when the config is missing', async () => {
    mockLoad.mockRejectedValue(new ConfigNotFoundError('Config file not found at /x'));
    await listOrgs({});
    expect(process.exitCode).toBeUndefined();
    const text = out.join('\n');
    expect(text).toMatch(/gitradar init/);
    expect(text).not.toMatch(/add-org/);
  });

  it('org list with an empty config points at "gitradar org add"', async () => {
    mockLoad.mockResolvedValue({
      repos: [],
      orgs: [],
      groups: {},
      tags: {},
      settings: { ...DEFAULT_SETTINGS },
    });
    await listOrgs({});
    const text = out.join('\n');
    expect(text).toMatch(/gitradar org add/);
    expect(text).not.toMatch(/add-org/);
  });
});
