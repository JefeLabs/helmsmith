import { describe, expect, it } from 'vitest';
import { CliCache } from './cache.js';

describe('CliCache.buildKey (G24)', () => {
  it('namespaces compare results by manifest, so two workspaces do not collide', () => {
    const a = CliCache.buildKey('compare', {
      manifest: '/ws-a/gittyup.yaml',
      left: 'dev',
      right: 'prod',
    });
    const b = CliCache.buildKey('compare', {
      manifest: '/ws-b/gittyup.yaml',
      left: 'dev',
      right: 'prod',
    });
    expect(a).not.toBe(b);
  });
  it('is stable for the same inputs', () => {
    const args = { manifest: '/ws/gittyup.yaml', left: 'dev', right: 'prod' };
    expect(CliCache.buildKey('compare', args)).toBe(CliCache.buildKey('compare', args));
  });
});
