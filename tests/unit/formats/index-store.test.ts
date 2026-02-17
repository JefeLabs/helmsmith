import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readComponentIndex,
  writeComponentIndex,
  readSymbolIndex,
  writeSymbolIndex,
} from '../../../src/formats/index-store.js';
import type { ComponentIndex, SymbolIndex } from '../../../src/parser/analysis/types.js';

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

const validComponentIndex: ComponentIndex = {
  version: 1,
  repoRoot: '/test/repo',
  generatedAt: '2026-02-16T00:00:00Z',
  components: [
    {
      id: 'test-pkg',
      name: 'test-pkg',
      rootPath: '/test/repo',
      languageSet: ['typescript'],
      entrypoints: ['src/index.ts'],
      publicSurface: [],
      tags: ['component:test-pkg', 'build:npm'],
    },
  ],
};

const validSymbolIndex: SymbolIndex = {
  version: 1,
  repoRoot: '/test/repo',
  generatedAt: '2026-02-16T00:00:00Z',
  entries: [
    {
      componentId: 'test-pkg',
      layer: 'api',
      symbols: [
        {
          name: 'handleRequest',
          kind: 'function',
          visibility: 'exported',
          filePath: 'src/api/handler.ts',
          source: {
            file: '/test/repo/src/api/handler.ts',
            range: { startLine: 1, endLine: 10 },
          },
          tags: ['layer:api'],
        },
      ],
    },
  ],
};

describe('readComponentIndex', () => {
  it('returns null for non-existent file', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'idx-test-'));
    const result = await readComponentIndex(tempDir);
    expect(result).toBeNull();
  });
});

describe('writeComponentIndex + readComponentIndex', () => {
  it('round-trips correctly', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'idx-test-'));
    await writeComponentIndex(tempDir, validComponentIndex);
    const result = await readComponentIndex(tempDir);
    expect(result).toEqual(validComponentIndex);
  });
});

describe('writeComponentIndex validation', () => {
  it('rejects invalid data before writing', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'idx-test-'));
    const invalid = { version: 2, repoRoot: '/bad', generatedAt: 'now', components: [] };
    await expect(
      writeComponentIndex(tempDir, invalid as unknown as ComponentIndex),
    ).rejects.toThrow();
  });
});

describe('readSymbolIndex', () => {
  it('returns null for non-existent file', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'idx-test-'));
    const result = await readSymbolIndex(tempDir);
    expect(result).toBeNull();
  });
});

describe('writeSymbolIndex + readSymbolIndex', () => {
  it('round-trips correctly', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'idx-test-'));
    await writeSymbolIndex(tempDir, validSymbolIndex);
    const result = await readSymbolIndex(tempDir);
    expect(result).toEqual(validSymbolIndex);
  });
});

describe('atomic write', () => {
  it('produces valid JSON after write completes', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'idx-test-'));
    await writeComponentIndex(tempDir, validComponentIndex);
    const raw = readFileSync(join(tempDir, 'component-index.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.repoRoot).toBe('/test/repo');
    expect(parsed.components).toHaveLength(1);
  });
});
