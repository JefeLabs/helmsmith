import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILT_IN_CATALOG } from '../core/built-in-catalog.js';
import { _resetCatalogCache, getMergedCatalog } from './catalog.js';

describe('merged catalog', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'toolz-catalog-test-'));
    process.env.AGENTX_TOOLZ_DIR = tmp;
    _resetCatalogCache();
  });

  afterEach(() => {
    delete process.env.AGENTX_TOOLZ_DIR;
    _resetCatalogCache();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the built-in catalog when no user catalog exists', () => {
    const catalog = getMergedCatalog();
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(BUILT_IN_CATALOG).sort());
  });

  it('merges user-only entries into the catalog', () => {
    writeFileSync(
      join(tmp, 'catalog.yaml'),
      `tools:
  custom-tool:
    description: My custom tool
    packages:
      brew: my-custom-tool
`,
      'utf8',
    );
    _resetCatalogCache();
    const catalog = getMergedCatalog();
    expect(catalog['custom-tool']).toBeDefined();
    expect(catalog['custom-tool']?.description).toBe('My custom tool');
    expect(catalog['custom-tool']?.packages.brew).toBe('my-custom-tool');
    // Built-in entries still present
    expect(catalog.git).toBeDefined();
  });

  it('user entry overrides built-in for the same tool name', () => {
    writeFileSync(
      join(tmp, 'catalog.yaml'),
      `tools:
  git:
    description: Custom git description
    packages:
      brew: git-custom
`,
      'utf8',
    );
    _resetCatalogCache();
    const catalog = getMergedCatalog();
    expect(catalog.git?.description).toBe('Custom git description');
    expect(catalog.git?.packages.brew).toBe('git-custom');
  });

  it('ignores a malformed user catalog (returns built-in only)', () => {
    writeFileSync(join(tmp, 'catalog.yaml'), '::invalid yaml: : :', 'utf8');
    _resetCatalogCache();
    const catalog = getMergedCatalog();
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(BUILT_IN_CATALOG).sort());
  });
});
