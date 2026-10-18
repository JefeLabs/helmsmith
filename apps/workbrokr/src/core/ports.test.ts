import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { claimRanges, rangesFor, rangesOverlap } from './ports.js';
import { Registry } from './registry.js';
import { minimal } from './testing/manifests.js';

describe('ports', () => {
  it('derives one range per service from the slot count', () => {
    expect(rangesFor(validateManifest(minimal))).toEqual({
      frontend: { base: 3000, count: 10 },
      backend: { base: 8443, count: 10 },
    });
  });
  it('detects overlapping ranges', () => {
    expect(rangesOverlap({ base: 3000, count: 10 }, { base: 3009, count: 10 })).toBe(true);
    expect(rangesOverlap({ base: 3000, count: 10 }, { base: 3010, count: 10 })).toBe(false);
  });
  it('claims ranges once and refuses another project on the same ports', () => {
    const r = Registry.open(mkdtempSync(join(tmpdir(), 'wk-ports-')));
    const m = validateManifest(minimal);
    claimRanges(r, m, '/a');
    claimRanges(r, m, '/a');
    expect(r.project('demo')?.ranges.frontend).toEqual({ base: 3000, count: 10 });
    expect(() => claimRanges(r, validateManifest({ ...minimal, project: 'other' }), '/b')).toThrow(
      /demo.*frontend/,
    );
  });
});
