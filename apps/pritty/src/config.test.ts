import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultStarterConfig, loadConfig } from './config.js';

describe('config baseBranch', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('is undefined when no config sets it, so the repository default can apply', () => {
    dir = mkdtempSync(join(tmpdir(), 'pritty-cfg-'));
    expect(loadConfig(dir).baseBranch).toBeUndefined();
  });

  it('is the configured value when .pritty.json sets it', () => {
    dir = mkdtempSync(join(tmpdir(), 'pritty-cfg-'));
    writeFileSync(join(dir, '.pritty.json'), JSON.stringify({ baseBranch: 'develop' }));
    expect(loadConfig(dir).baseBranch).toBe('develop');
  });

  it('the starter config does not pin a base branch', () => {
    expect(defaultStarterConfig()).not.toHaveProperty('baseBranch');
  });
});
