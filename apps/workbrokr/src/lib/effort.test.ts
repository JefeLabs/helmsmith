import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentOwner, Git, Registry, validateManifest } from '@helmsmith/workkit';
import { commitFile, makeRepo } from '@helmsmith/workkit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Ctx,
  effortEnv,
  type ServiceRunner,
  type StorybrokrClient,
  slotEnv,
  startEffort,
  statusFor,
} from './effort.js';

const manifest = validateManifest({
  project: 'demo',
  baseBranch: 'develop',
  worktreeRoot: '.claude/worktrees',
  ports: { services: { frontend: { base: 43000 }, backend: { base: 43100 } } },
  services: {
    backend: { start: 'true', stop: 'true', health: 'true' },
    frontend: { start: 'true', stop: 'true', health: 'true' },
  },
  scopes: { frontend: ['app-ui/app/{group}/{section}/**'], backend: ['svc/{module}/**'] },
  areas: {
    'shop/cart': { module: 'cart' },
    'shop/team': { module: 'team' },
    'platform/auth': { commons: ['auth'] },
  },
  commons: { auth: ['api/auth/**'] },
  refresh: [{ when: 'lock.json', run: 'touch refreshed.marker' }],
});

interface FakeRunner extends ServiceRunner {
  calls: string[];
  stopped: Record<string, number>[];
}
const fakeRunner = (): FakeRunner => {
  const r: FakeRunner = {
    calls: [],
    stopped: [],
    start: async () => {
      r.calls.push('start');
      return { pids: { backend: process.pid } };
    },
    stop: async (o) => {
      r.calls.push('stop');
      r.stopped.push(o.pids);
    },
  };
  return r;
};
const fakeSb = (): StorybrokrClient & { downs: string[] } => {
  const s = {
    downs: [] as string[],
    up: async () => ({ id: 'sb_1', port: 6101, url: 'http://x' }),
    down: async (id: string) => {
      s.downs.push(id);
    },
  };
  return s;
};

function ctxFor(
  f: { main: string },
  runner: FakeRunner = fakeRunner(),
  storybrokr = fakeSb(),
): Ctx & { runner: FakeRunner } {
  const home = mkdtempSync(join(tmpdir(), 'wk-eff-'));
  const registry = Registry.open(home);
  registry.upsertProject('demo', { root: f.main, ranges: {} });
  return {
    home,
    repoRoot: f.main,
    manifest,
    registry,
    owner: currentOwner({ WORK_SESSION: 's1' }),
    runner,
    storybrokr,
    log: () => {},
  };
}

describe('startEffort', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('creates the area worktree on <type>/<area>, syncs, leases a slot, emits config, starts services, records the effort', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    expect(r.effort.branch).toBe('feature/shop/cart');
    expect(new Git(r.effort.worktree).currentBranch()).toBe('feature/shop/cart');
    expect(r.leases.map((l) => l.kind)).toEqual(['slot']);
    expect(r.leases[0].value).toBe(1);
    expect(r.leases[0].pids).toEqual({ backend: process.pid });
    expect(ctx.registry.activeEffortFor('demo', 'shop/cart')?.id).toBe(r.effort.id);
    expect(ctx.runner.calls).toEqual(['start']);
    expect(r.sync).toBe('up-to-date');
  });

  it('refuses a second effort on the same area and names the owner; --join adopts it', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    const other = { ...ctx, owner: { session: 's2', pid: 2 } };
    await expect(
      startEffort(other, { area: 'shop/cart', type: 'fix', mode: 'frontend' }),
    ).rejects.toMatchObject({
      code: 'EFFORT_OPEN',
      details: { owner: 's1' },
    });
    const j = await startEffort(other, {
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      join: true,
    });
    expect(j.effort.area).toBe('shop/cart');
    expect(j.joined).toBe(true);
  });

  it('runs two frontend efforts on different sections side by side, refuses overlapping scopes', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    await expect(
      startEffort(ctx, { area: 'shop/team', type: 'feature', mode: 'frontend' }),
    ).resolves.toBeTruthy();
    const wide = {
      ...ctx,
      manifest: validateManifest({
        ...structuredClone(manifestRaw()),
        areas: {
          ...manifestRaw().areas,
          'shop/all': { module: 'all', extraScopes: ['app-ui/app/shop/**'] },
        },
      }),
    };
    await expect(
      startEffort(wide, { area: 'shop/all', type: 'feature', mode: 'frontend' }),
    ).rejects.toMatchObject({ code: 'SCOPE_CONFLICT' });
  });

  it('conflict stops before any lease', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(first.effort.worktree, 'README.md', 'mine', 'mine');
    commitFile(f.main, 'README.md', 'theirs', 'theirs');
    new Git(f.main).push('develop');
    ctx.registry.updateEffort(first.effort.id, { state: 'finished' });
    await expect(
      startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' }),
    ).rejects.toMatchObject({
      code: 'SYNC_CONFLICT',
      details: { conflicted: ['README.md'] },
    });
    expect(ctx.registry.leases({ kind: 'slot' })).toEqual([]);
    expect(ctx.runner.calls).toEqual([]);
  });

  it('runs refresh entries for paths the sync changed', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    ctx.registry.updateEffort(first.effort.id, { state: 'finished' });
    commitFile(f.main, 'lock.json', '{}', 'deps');
    new Git(f.main).push('develop');
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    expect(r.sync).toBe('ff');
    expect(r.refreshed).toEqual(['touch refreshed.marker']);
  });

  it('refuses to switch type while the other branch holds unshipped commits', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(first.effort.worktree, 'work.txt', '1', 'unshipped');
    ctx.registry.updateEffort(first.effort.id, { state: 'finished' });
    await expect(
      startEffort(ctx, { area: 'shop/cart', type: 'fix', mode: 'frontend' }),
    ).rejects.toMatchObject({ code: 'EFFORT_OPEN' });
  });

  it('a cross-cutting area takes commons write locks', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'platform/auth', type: 'fix', mode: 'frontend' });
    expect(r.leases.map((l) => `${l.kind}:${l.value}`)).toEqual(['commons:auth']);
  });

  it('frontend with a story records the storybrokr instance as a lease', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, {
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      story: 'components/cart/Cart.stories.tsx',
    });
    expect(r.leases.map((l) => `${l.kind}:${l.value}`)).toEqual(['storybook:sb_1']);
  });
});

describe('statusFor / effortEnv', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('reports every area, the open effort with its leases, how far behind the base it is, and the env', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    const s = statusFor(ctx);
    expect(s.project).toBe('demo');
    expect(s.areas.map((a) => a.area)).toEqual(['platform/auth', 'shop/cart', 'shop/team']);
    const cart = s.areas.find((a) => a.area === 'shop/cart');
    expect(cart?.effort?.mode).toBe('fullstack');
    expect(cart?.leases.map((l) => l.kind)).toEqual(['slot']);
    expect(cart?.behindBase).toBe(0);
    expect(s.areas.find((a) => a.area === 'shop/team')?.effort).toBeUndefined();
    commitFile(f.main, 'z.txt', '1', 'z');
    new Git(f.main).push('develop');
    expect(statusFor(ctx, 'shop/cart').areas[0].behindBase).toBe(1);
    const env = effortEnv(ctx, 'shop/cart');
    expect(env.PORT_BACKEND).toBe('43101');
    expect(env.SLOT).toBe('1');
    expect(env.MODE).toBe('fullstack');
    expect(env.WORKTREE).toBe(cart?.effort?.worktree);
    expect(slotEnv(ctx.manifest, 3).PORT_FRONTEND).toBe('43003');
    expect(() => effortEnv(ctx, 'shop/team')).toThrow(/no open effort/);
  });
});

function manifestRaw() {
  return {
    project: 'demo',
    baseBranch: 'develop',
    worktreeRoot: '.claude/worktrees',
    ports: { services: { frontend: { base: 43000 }, backend: { base: 43100 } } },
    services: {
      backend: { start: 'true', stop: 'true', health: 'true' },
      frontend: { start: 'true', stop: 'true', health: 'true' },
    },
    scopes: { frontend: ['app-ui/app/{group}/{section}/**'], backend: ['svc/{module}/**'] },
    areas: {
      'shop/cart': { module: 'cart' },
      'shop/team': { module: 'team' },
      'platform/auth': { commons: ['auth'] },
    },
    commons: { auth: ['api/auth/**'] },
    refresh: [{ when: 'lock.json', run: 'touch refreshed.marker' }],
  };
}
