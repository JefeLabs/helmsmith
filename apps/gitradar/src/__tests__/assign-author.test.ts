import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorRegistry, Config } from '../types/schema.js';

vi.mock('../store/sqlite-store.js', () => ({
  loadAuthorRegistrySQL: vi.fn(),
  reattributeRecordsSQL: vi.fn(() => 0),
  saveAuthorRegistrySQL: vi.fn(),
}));

vi.mock('../config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

import {
  assignAuthorCmd,
  buildTuiReattribution,
  bulkAssignCmd,
  planReattribution,
  resolveAssignment,
} from '../commands/assign-author.js';
import { loadConfig } from '../config/loader.js';
import { loadAuthorRegistrySQL, reattributeRecordsSQL } from '../store/sqlite-store.js';

const config = {
  orgs: [
    { name: 'Acme', type: 'core', teams: [{ name: 'FE', tag: 'web', members: [] }] },
    {
      name: 'ContractCo',
      type: 'consultant',
      teams: [{ name: 'Squad', tag: 'default', members: [] }],
    },
  ],
} as unknown as Config;

describe('resolveAssignment', () => {
  it('derives orgType and tag from config', () => {
    expect(resolveAssignment(config, 'ContractCo', 'Squad')).toEqual({
      orgType: 'consultant',
      tag: 'default',
    });
    expect(resolveAssignment(config, 'Acme', 'FE')).toEqual({ orgType: 'core', tag: 'web' });
  });
  it('falls back to tag default for an unknown team and throws for an unknown org', () => {
    expect(resolveAssignment(config, 'Acme', 'Nope')).toEqual({ orgType: 'core', tag: 'default' });
    expect(() => resolveAssignment(config, 'Ghost', 'FE')).toThrow(/Unknown org/);
  });
});

const configWithMembers = {
  orgs: [
    {
      name: 'Acme',
      type: 'core',
      teams: [
        {
          name: 'FE',
          tag: 'web',
          members: [{ name: 'Edwin Cruz', email: 'e@co.com' }],
        },
      ],
    },
  ],
} as unknown as Config;

describe('planReattribution', () => {
  it('derives orgType/tag/member from config when the org exists and a member matches the email', () => {
    expect(planReattribution(configWithMembers, 'e@co.com', 'ecruz', 'Acme', 'FE')).toEqual({
      ok: true,
      orgType: 'core',
      tag: 'web',
      member: 'Edwin Cruz',
    });
  });

  it('falls back to the given registry name when no config member matches the email', () => {
    expect(planReattribution(configWithMembers, 'nobody@co.com', 'ecruz', 'Acme', 'FE')).toEqual({
      ok: true,
      orgType: 'core',
      tag: 'web',
      member: 'ecruz',
    });
  });

  it('falls back to orgType core / tag default / the registry name when config is unavailable', () => {
    expect(planReattribution(undefined, 'e@co.com', 'ecruz', 'Acme', 'FE')).toEqual({
      ok: true,
      orgType: 'core',
      tag: 'default',
      member: 'ecruz',
    });
  });

  it('fails without falling back when config is available but the org is unknown', () => {
    expect(planReattribution(configWithMembers, 'e@co.com', 'ecruz', 'Ghost', 'FE')).toEqual({
      ok: false,
      error: 'Unknown org: Ghost',
    });
  });
});

// ── Command reporting ────────────────────────────────────────────────────────

const mockLoadRegistry = vi.mocked(loadAuthorRegistrySQL);
const mockReattribute = vi.mocked(reattributeRecordsSQL);
const mockLoadConfig = vi.mocked(loadConfig);

function registry(
  authors: Record<string, { name: string; email: string; org?: string; team?: string }>,
): AuthorRegistry {
  const full: AuthorRegistry['authors'] = {};
  for (const [key, a] of Object.entries(authors)) {
    full[key] = {
      ...a,
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-01T00:00:00.000Z',
      reposSeenIn: ['web'],
      commitCount: 1,
    } as AuthorRegistry['authors'][string];
  }
  return { version: 1, authors: full };
}

describe('assignAuthorCmd / bulkAssignCmd reporting', () => {
  let out: string[];
  let err: string[];
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      out.push(a.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      err.push(a.map(String).join(' '));
    });
    mockLoadConfig.mockResolvedValue(configWithMembers);
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('reports the rows re-attribution actually rewrote, not the whole store', async () => {
    mockLoadRegistry.mockReturnValue(
      registry({ 'e@co.com': { name: 'ecruz', email: 'e@co.com' } }),
    );
    mockReattribute.mockReturnValue(4);

    await assignAuthorCmd({ email: 'e@co.com', org: 'Acme', team: 'FE' });

    expect(out.join('\n')).toContain('Re-attributed 4 records.');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a re-attribution failure as an error and exits non-zero', async () => {
    mockLoadRegistry.mockReturnValue(
      registry({ 'e@co.com': { name: 'ecruz', email: 'e@co.com' } }),
    );
    mockReattribute.mockImplementation(() => {
      throw new Error('database is locked');
    });

    await assignAuthorCmd({ email: 'e@co.com', org: 'Acme', team: 'FE' });

    expect(err.join('\n')).toContain('database is locked');
    expect(out.join('\n')).not.toContain('Re-attributed');
    expect(process.exitCode).toBe(1);
  });

  it('bulk assign re-attributes and counts only the newly assigned authors', async () => {
    mockLoadRegistry.mockReturnValue(
      registry({
        // Already in Acme/FE before this command — untouched by the prefix pass.
        'old@co.com': { name: 'CONOLD Person', email: 'old@co.com', org: 'Acme', team: 'FE' },
        // Unassigned and matching the prefix — this is the only new assignment.
        'new@co.com': { name: 'CONNEW Person', email: 'new@co.com' },
      }),
    );
    mockReattribute.mockReturnValue(2);

    await bulkAssignCmd({ prefix: 'CONNEW', org: 'Acme', team: 'FE' });

    expect(mockReattribute).toHaveBeenCalledTimes(1);
    const updates = mockReattribute.mock.calls[0][0];
    expect(updates.map((u) => u.email)).toEqual(['new@co.com']);
    expect(out.join('\n')).toContain('Re-attributed 2 records for 1 author');
  });
});

// ── buildTuiReattribution (the TUI assignment flow's SQL updates) ─────────────

describe('buildTuiReattribution', () => {
  const reg = registry({
    'e@co.com': { name: 'ecruz', email: 'e@co.com' },
    'other@co.com': { name: 'Other Person', email: 'other@co.com' },
  });

  it('derives the same update the CLI would build, for every email in the group', () => {
    expect(
      buildTuiReattribution(configWithMembers, reg, ['E@co.com', 'other@co.com'], 'Acme', 'FE'),
    ).toEqual([
      {
        email: 'e@co.com',
        member: 'Edwin Cruz',
        org: 'Acme',
        orgType: 'core',
        team: 'FE',
        tag: 'web',
      },
      {
        email: 'other@co.com',
        member: 'Other Person',
        org: 'Acme',
        orgType: 'core',
        team: 'FE',
        tag: 'web',
      },
    ]);
  });

  it('maps an unassign to the unassigned org/team the in-memory pass uses', () => {
    expect(
      buildTuiReattribution(configWithMembers, reg, ['other@co.com'], undefined, undefined),
    ).toEqual([
      {
        email: 'other@co.com',
        member: 'Other Person',
        org: 'unassigned',
        orgType: 'core',
        team: 'unassigned',
        tag: 'default',
      },
    ]);
  });

  it('skips emails the registry does not know and orgs the config does not list', () => {
    expect(buildTuiReattribution(configWithMembers, reg, ['ghost@co.com'], 'Acme', 'FE')).toEqual(
      [],
    );
    expect(buildTuiReattribution(configWithMembers, reg, ['e@co.com'], 'Ghost', 'FE')).toEqual([]);
  });
});
