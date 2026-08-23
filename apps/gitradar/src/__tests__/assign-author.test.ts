import { describe, expect, it } from 'vitest';
import { planReattribution, resolveAssignment } from '../commands/assign-author.js';
import type { Config } from '../types/schema.js';

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
