import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Git } from './git.js';
import { checkCommit, checkPush } from './guards.js';
import { validateManifest } from './manifest.js';
import { Registry } from './registry.js';
import { makeRepo } from './testing/fixture-repo.js';
import { minimal } from './testing/manifests.js';

const m = validateManifest({
  ...minimal,
  commons: { auth: ['api/auth/**'] },
  areas: { 'shop/cart': { module: 'cart' }, 'platform/auth': { commons: ['auth'] } },
});
const reg = () => Registry.open(mkdtempSync(join(tmpdir(), 'wk-g-')));

describe('guards', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('refuses on develop with an empty registry', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const r = checkCommit({
      m,
      registry: reg(),
      git: new Git(f.main),
      project: 'demo',
      branch: 'develop',
      stagedPaths: ['x'],
      ownerSession: 's1',
    });
    expect(r.refusals[0]).toMatch(/develop.*protected/);
  });

  it('refuses a write under commons locked by another effort, names the owner, allows the owner', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    registry.addLease('commons', 'demo', 'auth', { session: 'other', pid: 2 }, 'eff_x', 4);
    const args = {
      m,
      registry,
      git: new Git(f.main),
      project: 'demo',
      branch: 'feature/shop/cart',
      stagedPaths: ['api/auth/login.ts'],
    };
    expect(checkCommit({ ...args, ownerSession: 's1' }).refusals[0]).toMatch(/auth.*locked.*other/);
    expect(checkCommit({ ...args, ownerSession: 'other' }).refusals).toEqual([]);
  });

  it('warns on a push that leaves the effort scope and on commons touched', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    registry.addEffort({
      id: 'e1',
      project: 'demo',
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      branch: 'feature/shop/cart',
      worktree: '/w',
      owner: { session: 's1', pid: 1 },
      state: 'active',
      scopes: ['app-ui/app/shop/cart/**'],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    const r = checkPush({
      m,
      registry,
      git: new Git(f.main),
      project: 'demo',
      branch: 'feature/shop/cart',
      changedPaths: ['app-ui/app/shop/cart/a.tsx', 'svc/other.ts', 'api/auth/x.ts'],
    });
    expect(r.refusals).toEqual([]);
    expect(r.warnings.join('\n')).toMatch(/svc\/other\.ts/);
    expect(r.warnings.join('\n')).toMatch(/commons auth/);
    expect(
      checkPush({
        m,
        registry,
        git: new Git(f.main),
        project: 'demo',
        branch: 'develop',
        changedPaths: [],
      }).refusals[0],
    ).toMatch(/protected/);
  });

  it('lets the holder commit under their own commons even when the session id differs, by worktree', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    registry.addEffort({
      id: 'eff_x',
      project: 'demo',
      area: 'platform/auth',
      type: 'fix',
      mode: 'frontend',
      branch: 'fix/platform/auth',
      worktree: f.main,
      owner: { session: 'shell-1', pid: 1 },
      state: 'active',
      scopes: [],
      commons: ['auth'],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    registry.addLease('commons', 'demo', 'auth', { session: 'shell-1', pid: 1 }, 'eff_x', 4);
    const r = checkCommit({
      m,
      registry,
      git: new Git(f.main),
      project: 'demo',
      branch: 'fix/platform/auth',
      stagedPaths: ['api/auth/login.ts'],
      ownerSession: 'hook-child',
      checkoutRoot: f.main,
    });
    expect(r.refusals).toEqual([]);
  });

  it('refuses a push whose DESTINATION is protected, and a delete of a protected ref', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const base = {
      m,
      registry: reg(),
      git: new Git(f.main),
      project: 'demo',
      changedPaths: [] as string[],
    };
    expect(
      checkPush({ ...base, branch: 'fix/platform/auth', remoteRef: 'refs/heads/develop' })
        .refusals[0],
    ).toMatch(/develop.*protected/);
    expect(
      checkPush({ ...base, branch: 'fix/platform/auth', remoteRef: 'refs/heads/fix/platform/auth' })
        .refusals,
    ).toEqual([]);
    expect(
      checkPush({ ...base, branch: '', remoteRef: 'refs/heads/develop', isDelete: true })
        .refusals[0],
    ).toMatch(/delete.*develop/);
  });
});
