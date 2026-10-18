import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { ensureRanges } from './ports.js';
import { Registry } from './registry.js';
import { minimal } from './testing/manifests.js';

describe('W14: port ranges follow the manifest', () => {
  it('re-checks and re-registers ranges when the manifest changed them, still refusing overlap', () => {
    const registry = Registry.open(mkdtempSync(join(tmpdir(), 'wk-ports-')));
    const v1 = validateManifest({
      ...minimal,
      ports: { services: { frontend: { base: 43000 }, backend: { base: 43100 } } },
    });
    ensureRanges(registry, v1, '/demo');
    expect(registry.project('demo')?.ranges.frontend?.base).toBe(43000);

    const v2 = validateManifest({
      ...minimal,
      ports: { services: { frontend: { base: 44000 }, backend: { base: 44100 } } },
    });
    ensureRanges(registry, v2, '/demo');
    expect(registry.project('demo')?.ranges.frontend?.base).toBe(44000);

    registry.upsertProject('other', { root: '/o', ranges: { web: { base: 44000, count: 10 } } });
    expect(() => ensureRanges(registry, v2, '/demo')).toThrow(/overlap/);
  });
});
