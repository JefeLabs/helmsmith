import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTsconfigPaths } from './tsconfig.js';

describe('readTsconfigPaths', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const make = (content: string) => {
    const d = mkdtempSync(join(tmpdir(), 'sb-tsc-'));
    dirs.push(d);
    writeFileSync(join(d, 'tsconfig.json'), content);
    return d;
  };

  it('returns {} when there is no tsconfig', () => {
    const d = mkdtempSync(join(tmpdir(), 'sb-tsc-'));
    dirs.push(d);
    expect(readTsconfigPaths(d)).toEqual({});
  });

  it('tolerates comments and trailing commas (tsconfig is JSONC)', () => {
    const d = make(`{
      // alias map
      "compilerOptions": {
        "paths": {
          "@/*": ["./src/*", "./*"], /* two targets */
          "@core/*": ["./components/core/*"],
        },
      },
    }`);
    expect(readTsconfigPaths(d)).toEqual({
      '@/*': ['./src/*', './*'],
      '@core/*': ['./components/core/*'],
    });
  });
});
