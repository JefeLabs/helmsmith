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

describe('config provider default', () => {
  it('is claude when no config names a provider', () => {
    expect(ConfigSchema.parse({}).provider).toBe('claude');
  });

  it('is claude in the starter config pritty init writes', () => {
    expect(defaultStarterConfig()).toMatchObject({ provider: 'claude' });
  });
});

describe('config in the .helmsmith folder', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  async function repo() {
    const { makeRepo, write } = await import('./testing/repo.js');
    const r = makeRepo();
    cleanup = r.cleanup;
    return { dir: r.dir, write: (path: string, content: string) => write(r.dir, path, content) };
  }

  it('finds .helmsmith/pritty.json at the repository root from a subdirectory', async () => {
    const r = await repo();
    r.write('.helmsmith/pritty.json', JSON.stringify({ baseBranch: 'develop' }));
    r.write('app-ui/src/keep', '');
    expect(loadConfig(join(r.dir, 'app-ui/src')).baseBranch).toBe('develop');
  });

  it('reads .helmsmith/pritty.yml', async () => {
    const r = await repo();
    r.write('.helmsmith/pritty.yml', 'baseBranch: develop\n');
    expect(loadConfig(r.dir).baseBranch).toBe('develop');
  });

  it('accepts .pritty.json beside it while the two hold the same config', async () => {
    const r = await repo();
    r.write('.pritty.json', JSON.stringify({ baseBranch: 'develop', provider: 'claude' }));
    r.write(
      '.helmsmith/pritty.json',
      JSON.stringify({ provider: 'claude', baseBranch: 'develop' }),
    );
    expect(loadConfig(r.dir).baseBranch).toBe('develop');
  });

  it('refuses, naming both files, when .pritty.json beside it holds a different config', async () => {
    const r = await repo();
    r.write('.pritty.json', JSON.stringify({ baseBranch: 'main' }));
    r.write('.helmsmith/pritty.json', JSON.stringify({ baseBranch: 'develop' }));
    expect(() => loadConfig(r.dir)).toThrow(/\.pritty\.json[\s\S]*\.helmsmith\/pritty\.json/);
  });

  it('still lets a nearer .pritty.json win over the root .helmsmith/pritty.json', async () => {
    const r = await repo();
    r.write('.helmsmith/pritty.json', JSON.stringify({ baseBranch: 'develop' }));
    r.write('pkg/.pritty.json', JSON.stringify({ baseBranch: 'release' }));
    expect(loadConfig(join(r.dir, 'pkg')).baseBranch).toBe('release');
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
  it('is Claude Opus 5.5 for anthropic, copilot and claude, GPT-6 Astra for openai, and never overrides an explicit model', async () => {
    const { effectiveModel } = await import('./config.js');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'anthropic' }))).toBe('claude-opus-5-5');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'copilot' }))).toBe('claude-opus-5-5');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'claude' }))).toBe('claude-opus-5-5');
    expect(effectiveModel(ConfigSchema.parse({ provider: 'openai' }))).toBe('gpt-6-astra');
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

describe('claude provider config', () => {
  it('keeps strict MCP config on when no config mentions it', () => {
    expect(ConfigSchema.parse({}).claude?.strictMcpConfig ?? true).toBe(true);
    expect(ConfigSchema.parse({ claude: {} }).claude?.strictMcpConfig).toBe(true);
  });

  it('turns strict MCP config off when claude.strictMcpConfig is false', () => {
    expect(ConfigSchema.parse({ claude: { strictMcpConfig: false } }).claude?.strictMcpConfig).toBe(
      false,
    );
  });

  it('rejects a non-boolean claude.strictMcpConfig', () => {
    expect(() => ConfigSchema.parse({ claude: { strictMcpConfig: 'no' } })).toThrow();
  });
});
