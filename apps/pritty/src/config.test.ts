import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigSchema, defaultStarterConfig, loadConfig } from './config.js';

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

describe('config lookup from inside a repository', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('finds the repository root .pritty.json from a subdirectory', async () => {
    const { makeRepo, write } = await import('./testing/repo.js');
    const r = makeRepo();
    cleanup = r.cleanup;
    write(r.dir, '.pritty.json', JSON.stringify({ baseBranch: 'develop' }));
    write(r.dir, 'app-ui/src/keep', '');
    expect(loadConfig(join(r.dir, 'app-ui/src')).baseBranch).toBe('develop');
  });

  it('prefers the nearest config when a subdirectory has its own', async () => {
    const { makeRepo, write } = await import('./testing/repo.js');
    const r = makeRepo();
    cleanup = r.cleanup;
    write(r.dir, '.pritty.json', JSON.stringify({ baseBranch: 'develop' }));
    write(r.dir, 'pkg/.pritty.json', JSON.stringify({ baseBranch: 'release' }));
    expect(loadConfig(join(r.dir, 'pkg')).baseBranch).toBe('release');
  });

  it('does not walk above the repository root', async () => {
    const { makeRepo, write } = await import('./testing/repo.js');
    const r = makeRepo();
    cleanup = r.cleanup;
    // a config one level above the repository must not be picked up
    write(join(r.dir, '..'), '.pritty.json', JSON.stringify({ baseBranch: 'outside' }));
    try {
      expect(loadConfig(r.dir).baseBranch).toBeUndefined();
    } finally {
      rmSync(join(r.dir, '..', '.pritty.json'), { force: true });
    }
  });
});

describe('inert config keys are gone', () => {
  it('the starter config writes no hook commands that nothing runs', () => {
    const starter = defaultStarterConfig() as Record<string, unknown>;
    expect(starter).not.toHaveProperty('preCommit');
    expect(starter).not.toHaveProperty('prePush');
  });

  it('a legacy config with the old keys still loads, and the keys are dropped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pritty-cfg-'));
    try {
      writeFileSync(
        join(dir, '.pritty.json'),
        JSON.stringify({
          preCommit: ['eslint'],
          prePush: ['test'],
          skipHooks: true,
          verbose: true,
        }),
      );
      const cfg = loadConfig(dir) as Record<string, unknown>;
      for (const k of ['preCommit', 'prePush', 'skipHooks', 'verbose'])
        expect(cfg).not.toHaveProperty(k);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('attribution config', () => {
  it('defaults to no trailers and no footer, and accepts both', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pritty-cfg-'));
    try {
      expect(loadConfig(dir).commitTrailers).toEqual([]);
      expect(loadConfig(dir).prFooter).toBeUndefined();
      writeFileSync(
        join(dir, '.pritty.json'),
        JSON.stringify({ commitTrailers: ['Co-Authored-By: a <a@x>'], prFooter: 'footer' }),
      );
      expect(loadConfig(dir).commitTrailers).toEqual(['Co-Authored-By: a <a@x>']);
      expect(loadConfig(dir).prFooter).toBe('footer');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('model default follows the provider', () => {
  it('is a Claude model for anthropic, gpt-4o for copilot and openai, and never overrides an explicit model', async () => {
    const { effectiveModel } = await import('./config.js');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'anthropic' }))).toBe('claude-opus-5-5');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'copilot' }))).toBe('gpt-4o');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'openai' }))).toBe('gpt-4o');
    expect(
      effectiveModel(ConfigSchema.parse({ provider: 'anthropic', model: 'claude-sonnet-5-5' })),
    ).toBe('claude-sonnet-5-5');
    expect(effectiveModel(ConfigSchema.parse({ model: 'o3' }))).toBe('o3');
  });

  it("picks the fallback provider's own default when the primary is unavailable", async () => {
    const { effectiveModel } = await import('./config.js');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'copilot' }), 'anthropic')).toBe(
      'claude-opus-5-5',
    );
  });
});
