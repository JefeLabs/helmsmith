/**
 * The exports map and the catalog must stay in lockstep.
 *
 * Catches the twelfth adapter added later without a matching exports entry —
 * which would be invisible until a consumer's import failed at runtime, since
 * Node's exports field BLOCKS any subpath that is not declared.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADAPTER_CATALOG } from './catalog.ts';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  exports: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  sideEffects?: boolean;
};

describe('exports map', () => {
  it('has a subpath entry for every catalog type', () => {
    const missing = Object.keys(ADAPTER_CATALOG).filter(
      (type) => manifest.exports[`./adapters/${type}`] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it('has no adapter subpath without a catalog entry', () => {
    const orphans = Object.keys(manifest.exports)
      .filter((key) => key.startsWith('./adapters/'))
      .map((key) => key.replace('./adapters/', ''))
      .filter((type) => ADAPTER_CATALOG[type] === undefined);
    expect(orphans).toEqual([]);
  });

  it('points each subpath at that adapter directory', () => {
    for (const type of Object.keys(ADAPTER_CATALOG)) {
      expect(manifest.exports[`./adapters/${type}`], type).toBe(`./src/adapters/${type}/index.ts`);
    }
  });

  it('exposes no ./all entry', () => {
    // A convenience barrel would re-import all five optional SDKs, which is the
    // module-load crash this package was refactored to remove.
    expect(manifest.exports['./all']).toBeUndefined();
    expect(manifest.exports['./adapters/all']).toBeUndefined();
  });
});

describe('manifest invariants', () => {
  it('declares itself side-effect free', () => {
    // True only because registration is an exported function rather than an
    // import-time side effect. If registration ever moves back into module
    // scope, this flag becomes a lie that silently breaks bundled consumers.
    expect(manifest.sideEffects).toBe(false);
  });

  it('declares no runtime dependencies', () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it('marks every provider SDK peer optional', () => {
    const meta = manifest.peerDependenciesMeta ?? {};
    for (const peer of [
      '@anthropic-ai/sdk',
      '@anthropic-ai/claude-agent-sdk',
      '@aws-sdk/client-bedrock-runtime',
      '@google/genai',
      'openai',
    ]) {
      expect(meta[peer]?.optional, peer).toBe(true);
    }
  });
});
