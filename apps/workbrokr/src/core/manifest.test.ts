import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadManifest, validateManifest } from './manifest.js';
import { minimal } from './testing/manifests.js';

describe('validateManifest', () => {
  it('fills defaults', () => {
    const m = validateManifest(minimal);
    expect(m.protectedBranches).toEqual(['develop']);
    expect(m.branch.types).toEqual(['feature', 'chore', 'fix']);
    expect(m.slots).toEqual({ count: 10, reserved: [0] });
    expect(m.expiry).toEqual({ slotHours: 12, commonsHours: 4, storybookHours: 2 });
    expect(m.worktreeRoot).toBe('.claude/worktrees');
    expect(m.env.file).toBe('.env.slot');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: manifest template placeholder
    expect(m.env.template.STORYBROKR_HOST).toBe('${STORYBROKR_HOST}');
  });
  it('rejects an area that is an ancestor of another', () => {
    expect(() => validateManifest({ ...minimal, areas: { shop: {}, 'shop/cart': {} } })).toThrow(
      /shop.*ancestor.*shop\/cart/,
    );
  });
  it('rejects a service without a port, a port without a service, and a reserved slot out of range', () => {
    expect(() =>
      validateManifest({ ...minimal, ports: { services: { frontend: { base: 3000 } } } }),
    ).toThrow(/backend.*port/);
    expect(() => validateManifest({ ...minimal, slots: { count: 3, reserved: [5] } })).toThrow(
      /reserved/,
    );
  });
  it('rejects a template variable the env cannot resolve', () => {
    expect(() =>
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a manifest placeholder, on purpose
      validateManifest({ ...minimal, env: { file: '.env', template: { X: '${PORT_NOPE}' } } }),
    ).toThrow(/PORT_NOPE/);
  });
  it('accepts seed, service modes, structured extraScopes, and sharedScopes', () => {
    const m = validateManifest({
      ...minimal,
      seed: ['.scripts-tools/worktree-seed.sh .'],
      services: {
        ...minimal.services,
        backend: { ...minimal.services.backend, modes: ['backend', 'fullstack'] },
      },
      areas: {
        'org/dashboard': {
          module: 'dashboard',
          extraScopes: { frontend: ['app-ui/widgets/**'], backend: ['svc/shared/**'] },
          sharedScopes: ['app-ui/components/discover-schools/dashboards/**'],
        },
      },
    });
    expect(m.seed).toEqual(['.scripts-tools/worktree-seed.sh .']);
    expect(m.areas['org/dashboard'].sharedScopes).toEqual([
      'app-ui/components/discover-schools/dashboards/**',
    ]);
  });
  it('rejects area names containing double-dash (--)', () => {
    expect(() =>
      validateManifest({ ...minimal, areas: { 'org/my--area': { module: 'x' } } }),
    ).toThrow(/areas/);
  });
});

describe('loadManifest', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), 'wk-man-'));
    dirs.push(d);
    return d;
  };

  it('loads .json, .mjs and .ts', async () => {
    const a = dir();
    writeFileSync(join(a, 'helmsmith.config.json'), JSON.stringify(minimal));
    expect((await loadManifest(a)).project).toBe('demo');
    const b = dir();
    writeFileSync(join(b, 'helmsmith.config.mjs'), `export default ${JSON.stringify(minimal)};`);
    expect((await loadManifest(b)).project).toBe('demo');
    const c = dir();
    writeFileSync(
      join(c, 'helmsmith.config.ts'),
      `const m = ${JSON.stringify(minimal)} as const;\nexport default m;`,
    );
    expect((await loadManifest(c)).project).toBe('demo');
  });
  it('names the repo when no manifest exists', async () => {
    await expect(loadManifest(dir())).rejects.toMatchObject({ code: 'MANIFEST_NOT_FOUND' });
  });
});

describe('branch names', () => {
  it('rejects a protected branch or base branch that is not a plain ref name', () => {
    expect(() =>
      validateManifest({ ...minimal, protectedBranches: ['develop', '"; rm -rf /; "'] }),
    ).toThrow(/protectedBranches/);
    expect(() => validateManifest({ ...minimal, baseBranch: 'dev $(id)' })).toThrow(/baseBranch/);
    expect(validateManifest({ ...minimal, baseBranch: 'release/v1.2' }).baseBranch).toBe(
      'release/v1.2',
    );
  });
});
