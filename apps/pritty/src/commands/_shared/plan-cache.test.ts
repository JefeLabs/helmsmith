import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filePlanCache, planKey } from './plan-cache.js';

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pritty-plan-cache-'));
  path = join(dir, 'pritty', 'commit-plan.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PLAN = [
  { category: 'app', message: 'fix(a): b', body: 'Refs #1', files: ['src/a.ts'] },
  { category: 'test', message: 'test(a): b', files: ['src/a.test.ts'] },
];

describe('filePlanCache', () => {
  it('returns the plan written under the same key, and nothing under another', async () => {
    const cache = filePlanCache(async () => path);
    await cache.write('k1', PLAN);
    expect(await cache.read('k1')).toEqual(PLAN);
    expect(await cache.read('k2')).toBeUndefined();
  });

  it('clear removes the file; reading a missing file is a miss, not an error', async () => {
    const cache = filePlanCache(async () => path);
    await cache.write('k1', PLAN);
    await cache.clear();
    expect(existsSync(path)).toBe(false);
    expect(await cache.read('k1')).toBeUndefined();
    await cache.clear();
  });

  it('treats a corrupt or wrongly shaped file as a miss', async () => {
    const cache = filePlanCache(async () => path);
    await cache.write('k1', PLAN);
    writeFileSync(path, '{not json');
    expect(await cache.read('k1')).toBeUndefined();
    writeFileSync(path, JSON.stringify({ key: 'k1', plan: [{ category: 'app', files: [] }] }));
    expect(await cache.read('k1')).toBeUndefined();
  });
});

describe('planKey', () => {
  const parts = {
    stagedState: 'h:t',
    branch: 'fix/x',
    commitStyle: 'conventional',
    categories: { app: ['src/**'] },
    version: '0.3.4',
  };

  it('is stable for the same inputs and changes with any of them', () => {
    expect(planKey(parts)).toBe(planKey({ ...parts }));
    for (const change of [
      { stagedState: 'h:t2' },
      { branch: 'fix/y' },
      { commitStyle: 'simple' },
      { categories: { app: ['lib/**'] } },
      { version: '0.3.5' },
    ]) {
      expect(planKey({ ...parts, ...change })).not.toBe(planKey(parts));
    }
  });
});
