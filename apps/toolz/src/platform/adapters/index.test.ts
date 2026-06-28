import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../detect.js';
import { adapters, brewAdapter, selectAdapter } from './index.js';

describe('adapter registry', () => {
  it('exposes the implemented adapters by name', () => {
    expect(adapters.brew).toBeDefined();
    expect(adapters.apt).toBeDefined();
    expect(adapters.winget).toBeDefined();
  });

  it('does not expose unimplemented adapters', () => {
    // dnf, pacman, apk, scoop, choco — not yet built.
    expect(adapters.dnf).toBeUndefined();
    expect(adapters.pacman).toBeUndefined();
    expect(adapters.apk).toBeUndefined();
    expect(adapters.scoop).toBeUndefined();
    expect(adapters.choco).toBeUndefined();
  });

  it('each adapter exposes the required interface members', () => {
    for (const adapter of [adapters.brew, adapters.apt, adapters.winget]) {
      expect(adapter).toBeDefined();
      expect(typeof adapter!.name).toBe('string');
      expect(typeof adapter!.isAvailable).toBe('function');
      expect(typeof adapter!.install).toBe('function');
      expect(typeof adapter!.uninstall).toBe('function');
      expect(typeof adapter!.isPackageInstalled).toBe('function');
    }
  });
});

describe('selectAdapter', () => {
  it("picks an adapter that's actually available on the host", async () => {
    const adapter = await selectAdapter();
    if (adapter === null) {
      // Acceptable on hosts with no implemented adapter (e.g. Fedora
      // without brew). Just make sure the result is an honest null,
      // not undefined or a thrown error.
      expect(adapter).toBeNull();
      return;
    }
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('on darwin, prefers brew', async () => {
    const info = detectPlatform();
    if (info.platform !== 'darwin') return; // skip on non-mac
    const adapter = await selectAdapter();
    if (adapter !== null) {
      expect(adapter.name).toBe('brew');
      expect(adapter).toBe(brewAdapter);
    }
  });
});
