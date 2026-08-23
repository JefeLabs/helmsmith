import { describe, expect, it } from 'vitest';
import { resolveAssignment } from '../commands/assign-author.js';
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
