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

  it('refuses commons write from another worktree even when both efforts share the same session id', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    const wtA = join(f.main, '.claude/worktrees/platform/auth');
    const wtB = join(f.main, '.claude/worktrees/shop/cart');
    new Git(f.main).worktreeAdd(wtA, 'fix/platform/auth', 'origin/develop');
    new Git(f.main).worktreeAdd(wtB, 'feature/shop/cart', 'origin/develop');
    registry.addEffort({
      id: 'eff_a',
      project: 'demo',
      area: 'platform/auth',
      type: 'fix',
      mode: 'frontend',
      branch: 'fix/platform/auth',
      worktree: wtA,
      owner: { session: 'same-user@host', pid: 1 },
      state: 'active',
      scopes: ['app-ui/app/platform/auth/**'],
      commons: ['auth'],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    registry.addLease('commons', 'demo', 'auth', { session: 'same-user@host', pid: 1 }, 'eff_a', 4);
    const refused = checkCommit({
      m,
      registry,
      git: new Git(wtB),
      project: 'demo',
      branch: 'feature/shop/cart',
      stagedPaths: ['api/auth/login.ts'],
      ownerSession: 'same-user@host',
      checkoutRoot: wtB,
    });
    expect(refused.refusals[0]).toMatch(/auth.*write-locked/);
    const allowed = checkCommit({
      m,
      registry,
      git: new Git(wtA),
      project: 'demo',
      branch: 'fix/platform/auth',
      stagedPaths: ['api/auth/login.ts'],
      ownerSession: 'same-user@host',
      checkoutRoot: wtA,
    });
    expect(allowed.refusals).toEqual([]);
  });

  it('refuses a commit touching another open effort exclusive scope and warns on out-of-scope paths', () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    const wtA = join(f.main, '.claude/worktrees/shop/cart');
    const wtB = join(f.main, '.claude/worktrees/platform/auth');
    new Git(f.main).worktreeAdd(wtA, 'feature/shop/cart', 'origin/develop');
    new Git(f.main).worktreeAdd(wtB, 'fix/platform/auth', 'origin/develop');
    registry.addEffort({
      id: 'eff_cart',
      project: 'demo',
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      branch: 'feature/shop/cart',
      worktree: wtA,
      owner: { session: 's1', pid: 1 },
      state: 'active',
      scopes: ['app-ui/app/shop/cart/**'],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    registry.addEffort({
      id: 'eff_auth',
      project: 'demo',
      area: 'platform/auth',
      type: 'fix',
      mode: 'frontend',
      branch: 'fix/platform/auth',
      worktree: wtB,
      owner: { session: 's2', pid: 2 },
      state: 'active',
      scopes: ['app-ui/app/platform/auth/**'],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    const r = checkCommit({
      m,
      registry,
      git: new Git(wtB),
      project: 'demo',
      branch: 'fix/platform/auth',
      stagedPaths: ['app-ui/app/shop/cart/page.tsx', 'unscoped/file.ts'],
      ownerSession: 's2',
      checkoutRoot: wtB,
    });
    expect(r.refusals[0]).toMatch(/active scope of shop\/cart/);
    expect(r.warnings[0]).toMatch(/outside the effort's scope.*unscoped\/file\.ts/);
  });
});

describe("W4: resolving a merge is not writing into another effort's scope", () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('exempts paths the merge brought in, still refuses paths authored during the merge', async () => {
    const { commitFile, gitIn } = await import('./testing/fixture-repo.js');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    registry.addEffort({
      id: 'e2',
      project: 'demo',
      area: 'shop/team',
      type: 'feature',
      mode: 'frontend',
      branch: 'feature/shop/team',
      worktree: '/w2',
      owner: { session: 'other', pid: 2 },
      state: 'active',
      scopes: ['app-ui/app/shop/team/**'],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    gitIn(f.main, 'checkout', '-q', '-b', 'feature/shop/cart', 'develop');
    commitFile(f.main, 'app-ui/app/shop/cart/a.tsx', 'a', 'cart');
    gitIn(f.main, 'checkout', '-q', 'develop');
    commitFile(f.main, 'app-ui/app/shop/team/t.tsx', 't', 'team landed on develop');
    gitIn(f.main, 'checkout', '-q', 'feature/shop/cart');
    gitIn(f.main, 'merge', '-q', '--no-commit', '--no-ff', 'develop');
    const git = new Git(f.main);
    const base = {
      m,
      registry,
      git,
      project: 'demo',
      branch: 'feature/shop/cart',
      ownerSession: 's1',
    };

    expect(checkCommit({ ...base, stagedPaths: git.changedPathsStaged() }).refusals).toEqual([]);

    mkdirSync(join(f.main, 'app-ui/app/shop/team'), { recursive: true });
    writeFileSync(join(f.main, 'app-ui/app/shop/team/mine.tsx'), 'edited during the merge');
    gitIn(f.main, 'add', 'app-ui/app/shop/team/mine.tsx');
    const r = checkCommit({ ...base, stagedPaths: git.changedPathsStaged() });
    expect(r.refusals.join('\n')).toMatch(/mine\.tsx.*shop\/team/);
    expect(r.refusals.join('\n')).not.toMatch(/t\.tsx/);
  });
});

describe('W8: tasks of one area share its commons', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('does not lock two efforts of the same area out of each other, still locks another area out', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const f = makeRepo();
    cleanup = f.cleanup;
    const registry = reg();
    const wa = mkdtempSync(join(tmpdir(), 'wk-wa-'));
    const wb = mkdtempSync(join(tmpdir(), 'wk-wb-'));
    const wc = mkdtempSync(join(tmpdir(), 'wk-wc-'));
    const effort = (
      id: string,
      area: string,
      task: string | undefined,
      worktree: string,
      session: string,
    ) => ({
      id,
      project: 'demo',
      area,
      task,
      type: 'feature' as const,
      mode: 'backend' as const,
      branch: task ? `feature/${area}--${task}` : `feature/${area}`,
      worktree,
      owner: { session, pid: 1 },
      state: 'active' as const,
      scopes: [],
      commons: area === 'platform/auth' ? ['auth'] : [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    registry.addEffort(effort('ea', 'platform/auth', 'a', wa, 'sa'));
    registry.addEffort(effort('eb', 'platform/auth', 'b', wb, 'sb'));
    registry.addEffort(effort('ec', 'shop/cart', undefined, wc, 'sc'));
    registry.addLease('commons', 'demo', 'auth', { session: 'sa', pid: 1 }, 'ea', 4);
    registry.addLease('commons', 'demo', 'auth', { session: 'sb', pid: 1 }, 'eb', 4);
    const base = {
      m,
      registry,
      git: new Git(f.main),
      project: 'demo',
      stagedPaths: ['api/auth/x.ts'],
    };

    expect(
      checkCommit({
        ...base,
        branch: 'feature/platform/auth--b',
        ownerSession: 'sb',
        checkoutRoot: wb,
      }).refusals,
    ).toEqual([]);
    expect(
      checkCommit({ ...base, branch: 'feature/shop/cart', ownerSession: 'sc', checkoutRoot: wc })
        .refusals[0],
    ).toMatch(/auth.*locked/);
  });
});
