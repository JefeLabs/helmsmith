import { describe, expect, it } from 'vitest';
import { detectPlatform, resetPlatformCache } from './detect.js';

describe('detectPlatform', () => {
  it('returns a populated PlatformInfo on the host', () => {
    resetPlatformCache();
    const info = detectPlatform();
    expect(info.platform).toMatch(/^(darwin|linux|win32)$/);
    expect(info.arch).toMatch(/^(x64|arm64)$/);
    expect(typeof info.isWSL).toBe('boolean');
  });

  it('caches the result across calls', () => {
    resetPlatformCache();
    const a = detectPlatform();
    const b = detectPlatform();
    expect(a).toBe(b); // same reference — cached
  });

  it('only sets linuxFamily when platform is linux', () => {
    resetPlatformCache();
    const info = detectPlatform();
    if (info.platform === 'linux') {
      expect(info.linuxFamily).toBeDefined();
    } else {
      expect(info.linuxFamily).toBeUndefined();
    }
  });
});
