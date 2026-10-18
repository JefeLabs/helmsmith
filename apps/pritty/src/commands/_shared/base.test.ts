import { describe, expect, it } from 'vitest';
import { resolveBaseBranch } from './base.js';

describe('resolveBaseBranch', () => {
  it('a --base flag is final', () => {
    expect(
      resolveBaseBranch({ flag: 'release', config: 'develop', remoteDefault: 'main' }),
    ).toEqual({
      base: 'release',
      source: 'flag',
    });
  });

  it("an explicit baseBranch in config wins over the repository's default branch", () => {
    expect(resolveBaseBranch({ config: 'develop', remoteDefault: 'main' })).toEqual({
      base: 'develop',
      source: 'config',
    });
  });

  it("falls back to the repository's default branch when nothing is configured", () => {
    expect(resolveBaseBranch({ remoteDefault: 'develop' })).toEqual({
      base: 'develop',
      source: 'remote',
    });
  });

  it('falls back to main when nothing is known', () => {
    expect(resolveBaseBranch({})).toEqual({ base: 'main', source: 'fallback' });
  });
});
