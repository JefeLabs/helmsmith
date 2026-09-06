import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import { DEFAULT_CONFIG, loadConfig } from './config.js';

describe('loadConfig', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('returns the spec defaults when config.json is absent', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    expect(loadConfig(home)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toEqual({
      ttlMinutes: 30,
      instanceCap: 6,
      portRangeStart: 6100,
      portRangeEnd: 6199,
      readinessTimeoutMs: 120_000,
      reaperIntervalMs: 60_000,
      autoStartWaitMs: 10_000,
    });
  });

  it('merges known keys from config.json and ignores unknown ones', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ ttlMinutes: 5, bogus: 1 }));
    expect(loadConfig(home)).toEqual({ ...DEFAULT_CONFIG, ttlMinutes: 5 });
  });

  it('rejects a non-numeric value with a clear error', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    writeFileSync(join(home, 'config.json'), JSON.stringify({ instanceCap: 'six' }));
    expect(() => loadConfig(home)).toThrow(/instanceCap/);
  });

  it('rejects malformed JSON with a StorybrokrError', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    writeFileSync(join(home, 'config.json'), '{ not json');
    try {
      loadConfig(home);
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as StorybrokrError;
      expect(err).toBeInstanceOf(StorybrokrError);
      expect(err.code).toBe('INTERNAL');
      expect(err.message).toMatch(/invalid JSON/);
    }
  });

  it('rejects non-object JSON with a StorybrokrError', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    writeFileSync(join(home, 'config.json'), '"just a string"');
    try {
      loadConfig(home);
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as StorybrokrError;
      expect(err).toBeInstanceOf(StorybrokrError);
      expect(err.code).toBe('INTERNAL');
      expect(err.message).toMatch(/JSON object/);
    }
  });

  it('rejects array JSON with a StorybrokrError', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-cfg-'));
    dirs.push(home);
    writeFileSync(join(home, 'config.json'), '[1, 2]');
    try {
      loadConfig(home);
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as StorybrokrError;
      expect(err).toBeInstanceOf(StorybrokrError);
      expect(err.code).toBe('INTERNAL');
      expect(err.message).toMatch(/JSON object/);
    }
  });
});
