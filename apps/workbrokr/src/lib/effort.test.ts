import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { currentOwner, ensureExcluded, Git, Registry, validateManifest } from '../core/index.js';
import { commitFile, makeRepo } from '../core/testing/index.js';
import {
  auditProject,
  type Ctx,
  effortEnv,
  finishEffort,
  type PrittyClient,
  prEffort,
  promoteEffort,
  reapLeases,
  retireArea,
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
const fakeSb = (): StorybrokrClient & {
  ups: Array<{ story: string; hostRoot: string; ttlMinutes?: number }>;
  downs: string[];
  downHosts: string[];
  touches: string[];
} => {
  const s = {
    ups: [] as Array<{ story: string; hostRoot: string; ttlMinutes?: number }>,
    downs: [] as string[],
    downHosts: [] as string[],
    touches: [] as string[],
    up: async (story: string, hostRoot: string, opts?: { ttlMinutes?: number }) => {
      s.ups.push({ story, hostRoot, ttlMinutes: opts?.ttlMinutes });
      return { id: 'sb_1', port: 6101, url: 'http://x' };
    },
    down: async (id: string) => {
      s.downs.push(id);
    },
    downHost: async (hostRoot: string) => {
      s.downHosts.push(hostRoot);
    },
    touch: async (id: string) => {
      s.touches.push(id);
    },
  };
  return s;
};

type FakePritty = PrittyClient & {
  calls: Array<{ kind: 'check' | 'pr'; o: Record<string, unknown> }>;
  open: { number: number; url: string; draft: boolean } | null;
  last: { number: number; url: string; state: 'MERGED' | 'CLOSED' } | null;
  versionString: string;
};
const fakePritty = (version = '0.1.2'): FakePritty => {
  let n = 100;
  const p: FakePritty = {
    calls: [],
    open: null,
    last: null,
    versionString: version,
    version: () => p.versionString,
    check: async (o) => {
      p.calls.push({ kind: 'check', o: o as unknown as Record<string, unknown> });
      return { open: p.open, last: p.last };
    },
    pr: async (o) => {
      p.calls.push({ kind: 'pr', o: o as unknown as Record<string, unknown> });
      if (p.open) return { ...p.open, created: false };
      n++;
      p.open = { number: n, url: `https://github.com/acme/app/pull/${n}`, draft: Boolean(o.draft) };
      return { ...p.open, created: true };
    },
  };
  return p;
};

function ctxFor(
  f: { main: string },
  runner: FakeRunner = fakeRunner(),
  storybrokr = fakeSb(),
  pritty: FakePritty = fakePritty(),
): Ctx & { runner: FakeRunner; pritty: FakePritty } {
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
    pritty,
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

describe('finishEffort / reapLeases', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('finish refuses a dirty worktree, parks with --park, stops the recorded pids, releases leases, pushes', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    writeFileSync(join(r.effort.worktree, 'dirty.txt'), 'x');
    await expect(finishEffort(ctx, { area: 'shop/cart' })).rejects.toMatchObject({
      code: 'DIRTY_WORKTREE',
    });
    const done = await finishEffort(ctx, { area: 'shop/cart', park: true });
    expect(done.pushed).toBe(true);
    expect(done.parked).toBe(true);
    expect(new Git(f.main).remoteBranchExists('feature/shop/cart')).toBe(true);
    expect(ctx.registry.leases()).toEqual([]);
    expect(ctx.runner.calls).toEqual(['start', 'stop']);
    expect(ctx.runner.stopped).toEqual([{ backend: process.pid }]);
    expect(ctx.registry.activeEffortFor('demo', 'shop/cart')).toBeUndefined();
    expect(ctx.registry.efforts({ area: 'shop/cart' })[0].state).toBe('finished');
  });

  it('finish brings a storybrokr instance down and leaves notices on other areas when commons changed', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const sb = fakeSb();
    const ctx = ctxFor(f, fakeRunner(), sb);
    const r = await startEffort(ctx, {
      area: 'platform/auth',
      type: 'fix',
      mode: 'frontend',
      story: 'x.stories.tsx',
    });
    commitFile(r.effort.worktree, 'api/auth/x.ts', '1', 'auth change');
    const done = await finishEffort(ctx, { area: 'platform/auth' });
    expect(sb.downs).toEqual(['sb_1']);
    expect(done.notices).toBe(2);
    const s = statusFor(ctx, 'shop/cart');
    expect(s.areas[0].notices[0].text).toMatch(/commons auth changed on fix\/platform\/auth/);
  });

  it('reap stops only the recorded pids of an expired lease and parks the effort', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    const lease = r.leases[0];
    expect((await reapLeases(ctx, { now: new Date() })).reaped).toEqual([]);
    const late = new Date(Date.parse(lease.expires) + 60_000);
    const dry = await reapLeases(ctx, { now: late, dryRun: true });
    expect(dry.reaped.map((l) => l.id)).toEqual([lease.id]);
    expect(ctx.registry.leases()).toHaveLength(1);
    const out = await reapLeases(ctx, { now: late });
    expect(out.reaped.map((l) => l.id)).toEqual([lease.id]);
    expect(ctx.registry.leases()).toEqual([]);
    expect(ctx.registry.efforts({ area: 'shop/cart' })[0].state).toBe('parked');
    expect(ctx.registry.efforts({ area: 'shop/cart' })[0].parkedReason).toMatch(/idle/);
    expect(ctx.runner.stopped).toEqual([{ backend: process.pid }]);
  });
});

describe('retireArea / auditProject', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('retire refuses while open or unpushed, then archives, removes the worktree and the local branch', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = {
      ...ctxFor(f),
      manifest: validateManifest({
        ...manifestRaw(),
        archive: { paths: ['evidence'], keepDays: 30, keepPerArea: 5 },
      }),
    };
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    await expect(retireArea(ctx, { area: 'shop/cart' })).rejects.toMatchObject({
      code: 'EFFORT_OPEN',
    });
    await finishEffort(ctx, { area: 'shop/cart' });
    commitFile(r.effort.worktree, 'w2.txt', '2', 'after finish');
    await expect(retireArea(ctx, { area: 'shop/cart' })).rejects.toMatchObject({
      code: 'UNPUSHED',
    });
    new Git(r.effort.worktree).push('feature/shop/cart');
    ensureExcluded(r.effort.worktree, ['evidence/']);
    mkdirSync(join(r.effort.worktree, 'evidence'));
    writeFileSync(join(r.effort.worktree, 'evidence/run.txt'), 'x');
    const out = await retireArea(ctx, { area: 'shop/cart' });
    expect(existsSync(r.effort.worktree)).toBe(false);
    expect(new Git(f.main).branchExists('feature/shop/cart')).toBe(false);
    expect(out.archived).toHaveLength(1);
    expect(existsSync(join(out.archived[0], 'run.txt'))).toBe(true);
    expect(ctx.registry.efforts({ area: 'shop/cart' })).toEqual([]);
  });

  it('audit is empty when clean, then lists a dirty area and a foreign worktree', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    expect(await auditProject(ctx)).toEqual([]);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    writeFileSync(join(r.effort.worktree, 'dirty.txt'), 'x');
    new Git(f.main).worktreeAdd(join(f.main, '.claude/worktrees/tmp/x'), 'tmp/x', 'origin/develop');
    const findings = await auditProject(ctx);
    expect(findings.map((x) => x.kind).sort()).toEqual(['dirty', 'foreign-branch']);
    expect(findings.find((x) => x.kind === 'dirty')?.area).toBe('shop/cart');
  });
});

describe('fix pass', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('C1: a leftover directory at the area path is refused, and the main checkout is untouched', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    mkdirSync(join(f.main, '.claude/worktrees/shop/cart'), { recursive: true });
    writeFileSync(join(f.main, '.claude/worktrees/shop/cart/.DS_Store'), '');
    const statusBefore = new Git(f.main).run(['status', '--porcelain']);
    await expect(
      startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' }),
    ).rejects.toMatchObject({ code: 'WORKTREE_INVALID' });
    expect(new Git(f.main).currentBranch()).toBe('develop');
    expect(new Git(f.main).run(['status', '--porcelain'])).toBe(statusBefore);
    expect(existsSync(join(f.main, '.env.slot'))).toBe(false);
    expect(ctx.registry.efforts()).toEqual([]);
  });

  it('I3: two concurrent starts on one area admit exactly one', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const results = await Promise.allSettled([
      startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' }),
      startEffort(
        { ...ctx, owner: { session: 's2', pid: 2 } },
        { area: 'shop/cart', type: 'feature', mode: 'fullstack' },
      ),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0].reason as { code: string }).code).toBe('EFFORT_OPEN');
    expect(ctx.registry.leases({ kind: 'slot' })).toHaveLength(1);
  });

  it('I4: the effort is recorded before services start, pids land on the lease as they spawn, and reap leaves a starting effort alone', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    let seenDuringStart: string | undefined;
    let pidsDuringStart: Record<string, number> | undefined;
    const runner: FakeRunner = {
      calls: [],
      stopped: [],
      start: async (a) => {
        seenDuringStart = ctx.registry.openEffortFor('demo', 'shop/cart')?.state;
        a.onSpawn?.('backend', 4242, 'sig');
        pidsDuringStart = ctx.registry.leases({ kind: 'slot' })[0]?.pids;
        const reaped = await reapLeases(ctx, { now: new Date(Date.now() + 100 * 3_600_000) });
        expect(reaped.reaped).toEqual([]);
        return { pids: { backend: 4242 }, signatures: { backend: 'sig' } };
      },
      stop: async () => {},
    };
    const ctx = ctxFor(f, runner);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    expect(seenDuringStart).toBe('starting');
    expect(pidsDuringStart).toEqual({ backend: 4242 });
    expect(r.effort.state).toBe('active');
    expect(r.leases[0].signatures).toEqual({ backend: 'sig' });
  });

  it('I5: a slot whose port is busy is skipped, and a lease whose port still answers is not garbage even without its worktree', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const busy = createServer().listen(43101, '127.0.0.1');
    await new Promise((res) => busy.once('listening', res));
    try {
      const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
      expect(r.leases[0].value).toBe(2);
      ctx.registry.updateEffort(r.effort.id, { worktree: '/nonexistent/worktree' });
      ctx.registry.patchLease(r.leases[0].id, { ports: { frontend: 43002, backend: 43101 } });
      const kept = await reapLeases(ctx, { now: new Date() });
      expect(kept.reaped).toEqual([]);
    } finally {
      busy.close();
    }
  });

  it('I5b: releasing a lease whose worktree is gone still signals its pids, skipping the stop commands', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    ctx.registry.updateEffort(r.effort.id, { worktree: '/nonexistent/worktree' });
    const late = new Date(Date.parse(r.leases[0].expires) + 1000);
    await reapLeases(ctx, { now: late });
    expect(ctx.runner.calls).toEqual(['start', 'stop']);
    expect(ctx.runner.stopped).toEqual([{ backend: process.pid }]);
  });

  it('I6: when one lease of an effort expires the whole effort is released and parked once; finish accepts the parked effort', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const cross = validateManifest({
      ...manifestRaw(),
      areas: { ...manifestRaw().areas, 'platform/auth': { module: 'auth', commons: ['auth'] } },
    });
    const c = { ...ctx, manifest: cross };
    const r = await startEffort(c, { area: 'platform/auth', type: 'fix', mode: 'fullstack' });
    expect(r.leases.map((l) => l.kind).sort()).toEqual(['commons', 'slot']);
    const fiveHours = new Date(Date.now() + 5 * 3_600_000);
    const out = await reapLeases(c, { now: fiveHours });
    expect(out.reaped).toHaveLength(2);
    expect(c.registry.leases()).toEqual([]);
    expect(c.registry.efforts({ area: 'platform/auth' })[0].state).toBe('parked');
    const done = await finishEffort(c, { area: 'platform/auth' });
    expect(done.effort.state).toBe('finished');
  });

  it('I7: status and env touch the leases, so idle expiry is measured from use', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    const before = r.leases[0].expires;
    await new Promise((res) => setTimeout(res, 1100));
    statusFor(ctx, 'shop/cart');
    const afterStatus = ctx.registry.leases({ kind: 'slot' })[0].expires;
    expect(Date.parse(afterStatus)).toBeGreaterThan(Date.parse(before));
    await new Promise((res) => setTimeout(res, 1100));
    effortEnv(ctx, 'shop/cart');
    expect(Date.parse(ctx.registry.leases({ kind: 'slot' })[0].expires)).toBeGreaterThan(
      Date.parse(afterStatus),
    );
  });

  it("I11: notices come only from the branch's own changes, persist across starts, and start reports them", async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(first.effort.worktree, 'app-ui/app/shop/cart/page.tsx', '1', 'cart only');
    commitFile(f.main, 'api/auth/login.ts', '1', 'develop changes auth');
    new Git(f.main).push('develop');
    await finishEffort(ctx, { area: 'shop/cart' });
    expect(statusFor(ctx, 'shop/team').areas[0].notices).toEqual([]);
    const auth = await startEffort(ctx, { area: 'platform/auth', type: 'fix', mode: 'frontend' });
    commitFile(auth.effort.worktree, 'api/auth/x.ts', '2', 'auth change');
    await finishEffort(ctx, { area: 'platform/auth' });
    expect(statusFor(ctx, 'shop/team').areas[0].notices).toHaveLength(1);
    const again = await startEffort(ctx, { area: 'shop/team', type: 'feature', mode: 'frontend' });
    expect(again.notices).toHaveLength(1);
    expect(statusFor(ctx, 'shop/team').areas[0].notices).toHaveLength(1);
  });

  it('I12: archives nest per area with second resolution, retention never touches a sibling area, and a file path archives', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const m = validateManifest({
      ...manifestRaw(),
      areas: { ...manifestRaw().areas, 'shop/cart-v2': { module: 'cart2' } },
      archive: { paths: ['evidence', 'trace.log'], keepDays: 30, keepPerArea: 2 },
    });
    const ctx = { ...ctxFor(f), manifest: m };
    const root = join(f.main, '.slot-archive');
    for (const d of [
      'shop/cart/20200101-000001',
      'shop/cart/20200101-000002',
      'shop/cart/20200101-000003',
      'shop/cart-v2/20200101-000001',
    ]) {
      mkdirSync(join(root, d), { recursive: true });
    }
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    await finishEffort(ctx, { area: 'shop/cart' });
    ensureExcluded(r.effort.worktree, ['evidence/', 'trace.log']);
    mkdirSync(join(r.effort.worktree, 'evidence'));
    writeFileSync(join(r.effort.worktree, 'evidence/run.txt'), 'x');
    writeFileSync(join(r.effort.worktree, 'trace.log'), 'trace');
    const out = await retireArea(ctx, { area: 'shop/cart' });
    expect(out.archived).toHaveLength(2);
    expect(out.archived[1].endsWith('trace.log')).toBe(true);
    expect(existsSync(join(root, 'shop/cart-v2/20200101-000001'))).toBe(true);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(join(root, 'shop/cart')).length).toBeLessThanOrEqual(2);
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

describe('parallel waves, promote, join ref-counting & squash-merge recovery', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('runs parallel backend + narrowed frontend tasks in the same area and converges them with --into-area', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const api = await startEffort(ctx, {
      area: 'shop/cart',
      task: 'api',
      type: 'feature',
      mode: 'backend',
    });
    const viewA = await startEffort(
      { ...ctx, owner: { session: 's2', pid: 2 } },
      {
        area: 'shop/cart',
        task: 'search-input',
        type: 'feature',
        mode: 'frontend',
        scopes: ['app-ui/app/shop/cart/SearchInput/**'],
      },
    );
    const viewB = await startEffort(
      { ...ctx, owner: { session: 's3', pid: 3 } },
      {
        area: 'shop/cart',
        task: 'user-card',
        type: 'feature',
        mode: 'frontend',
        scopes: ['app-ui/app/shop/cart/UserCard/**'],
      },
    );
    expect(api.effort.branch).toBe('feature/shop/cart--api');
    expect(viewA.effort.worktree).toContain('_tasks/shop/cart--search-input');
    commitFile(api.effort.worktree, 'svc/cart/handler.go', 'package cart', 'api work');
    commitFile(
      viewA.effort.worktree,
      'app-ui/app/shop/cart/SearchInput/index.tsx',
      'export const S = 1;',
      'view A',
    );
    commitFile(
      viewB.effort.worktree,
      'app-ui/app/shop/cart/UserCard/index.tsx',
      'export const U = 2;',
      'view B',
    );

    const finApi = await finishEffort(ctx, { area: 'shop/cart', task: 'api', intoArea: true });
    expect(finApi.mergedIntoArea).toBe(true);
    expect(existsSync(api.effort.worktree)).toBe(false);
    await finishEffort(
      { ...ctx, owner: { session: 's2', pid: 2 } },
      { area: 'shop/cart', task: 'search-input', intoArea: true },
    );
    await finishEffort(
      { ...ctx, owner: { session: 's3', pid: 3 } },
      { area: 'shop/cart', task: 'user-card', intoArea: true },
    );

    const areaEffort = await startEffort(ctx, {
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
    });
    expect(existsSync(join(areaEffort.effort.worktree, 'svc/cart/handler.go'))).toBe(true);
    expect(
      existsSync(join(areaEffort.effort.worktree, 'app-ui/app/shop/cart/SearchInput/index.tsx')),
    ).toBe(true);
    expect(
      existsSync(join(areaEffort.effort.worktree, 'app-ui/app/shop/cart/UserCard/index.tsx')),
    ).toBe(true);

    const promoted = await promoteEffort(ctx, { area: 'shop/cart', mode: 'fullstack' });
    expect(promoted.effort.mode).toBe('fullstack');
    expect(promoted.leases.some((l) => l.kind === 'slot')).toBe(true);
  });

  it('reference-counts --join participants and refuses incompatible mode on --join', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    const other = { ...ctx, owner: { session: 's2', pid: 2 } };
    await expect(
      startEffort(other, { area: 'shop/cart', type: 'feature', mode: 'fullstack', join: true }),
    ).rejects.toMatchObject({ code: 'MODE_MISMATCH' });
    const joined = await startEffort(other, {
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      join: true,
    });
    expect(joined.effort.participants).toEqual([{ session: 's2', pid: 2 }]);
    const left = await finishEffort(other, { area: 'shop/cart' });
    expect(left.left).toBe(true);
    expect(left.pushed).toBe(false);
    expect(ctx.registry.openEffortFor('demo', 'shop/cart')).toBeDefined();
    commitFile(joined.effort.worktree, 'app-ui/app/shop/cart/j.tsx', 'j', 'joined work');
    const final = await finishEffort(ctx, { area: 'shop/cart' });
    expect(final.pushed).toBe(true);
  });

  it('recovers cleanly when a previous branch was squash-merged into baseBranch', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const first = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(first.effort.worktree, 'app-ui/app/shop/cart/page.tsx', 'v1', 'feat commit');
    await finishEffort(ctx, { area: 'shop/cart' });
    commitFile(f.main, 'app-ui/app/shop/cart/page.tsx', 'v1', 'squash merged PR');
    new Git(f.main).push('develop');
    const next = await startEffort(ctx, { area: 'shop/cart', type: 'fix', mode: 'frontend' });
    expect(next.effort.branch).toBe('fix/shop/cart');
  });

  it('emits 0 notices when an effort made no commits of its own', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'platform/auth', type: 'chore', mode: 'frontend' });
    expect(r.effort.baseSha).toBeDefined();
    const done = await finishEffort(ctx, { area: 'platform/auth' });
    expect(done.notices).toBe(0);
  });

  it('passes ttlMinutes from expiry.storybookHours to storybrokr.up, throttles storybrokr.touch to 60s, and sweeps downHost on finish/reap/retire', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const sb = fakeSb();
    const customManifest = validateManifest({
      ...manifestRaw(),
      storybook: { hostRoot: 'app-ui' },
      expiry: { slotHours: 12, commonsHours: 4, storybookHours: 2.5 },
    });
    const ctx = { ...ctxFor(f, fakeRunner(), sb), manifest: customManifest };
    const r = await startEffort(ctx, {
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      story: 'components/cart/Cart.stories.tsx',
    });
    const expectedHost = join(r.effort.worktree, 'app-ui');
    expect(sb.ups).toEqual([
      {
        story: 'components/cart/Cart.stories.tsx',
        hostRoot: expectedHost,
        ttlMinutes: 150,
      },
    ]);
    expect(effortEnv(ctx, 'shop/cart').STORYBROKR_HOST).toBe(expectedHost);
    // Immediate status/env within 60s of start should NOT call storybrokr.touch
    statusFor(ctx, 'shop/cart');
    expect(sb.touches).toEqual([]);

    // Backdate lastActivity by > 60s so next touchEffort forwards to storybrokr.touch
    ctx.registry.updateEffort(r.effort.id, {
      lastActivity: new Date(Date.now() - 65_000).toISOString(),
    });
    statusFor(ctx, 'shop/cart');
    expect(sb.touches).toEqual(['sb_1']);

    await finishEffort(ctx, { area: 'shop/cart' });
    expect(sb.downs).toEqual(['sb_1']);
    expect(sb.downHosts).toEqual([expectedHost]);

    await retireArea(ctx, { area: 'shop/cart' });
    expect(sb.downHosts).toEqual([expectedHost, expectedHost]);
  });
});

describe('W3: pushes and origin-only branches', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('a rejected push leaves the leases, the services and the effort untouched', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { gitIn } = await import('../core/testing/fixture-repo.js');
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    commitFile(r.effort.worktree, 'cart.txt', '1', 'c1');
    // meanwhile someone else put a different commit on origin's feature/shop/cart
    gitIn(f.main, 'checkout', '-q', '-b', 'tmp-other', 'develop');
    commitFile(f.main, 'other.txt', 'x', 'other');
    gitIn(f.main, 'push', '-q', 'origin', 'tmp-other:refs/heads/feature/shop/cart');
    gitIn(f.main, 'checkout', '-q', 'develop');
    gitIn(f.main, 'branch', '-q', '-D', 'tmp-other');

    await expect(finishEffort(ctx, { area: 'shop/cart' })).rejects.toThrow(/push/i);

    expect(ctx.registry.leases({ effort: r.effort.id })).toHaveLength(1);
    expect(ctx.runner.calls).not.toContain('stop');
    expect(ctx.registry.openEffortFor('demo', 'shop/cart')?.state).toBe('active');
  });

  it('an area branch that exists only on origin is checked out from it, not recreated from the base', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { gitIn } = await import('../core/testing/fixture-repo.js');
    gitIn(f.main, 'checkout', '-q', '-b', 'feature/shop/cart', 'develop');
    commitFile(f.main, 'cart.txt', '1', 'earlier cart work');
    gitIn(f.main, 'push', '-q', 'origin', 'feature/shop/cart');
    gitIn(f.main, 'checkout', '-q', 'develop');
    gitIn(f.main, 'branch', '-q', '-D', 'feature/shop/cart');

    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });

    expect(gitIn(r.effort.worktree, 'log', '--format=%s', '-n', '3')).toContain(
      'earlier cart work',
    );
    expect(new Git(r.effort.worktree).unpushedCount('develop')).toBe(0);
    const done = await finishEffort(ctx, { area: 'shop/cart' });
    expect(done.pushed).toBe(true);
  });
});

describe('W2: a start that died before its first lease', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('is parked by reap once the grace period has passed, and left alone inside it', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    for (const l of ctx.registry.leases({ effort: r.effort.id })) ctx.registry.release(l.id);
    // the shape a SIGKILL during fetch/worktree add/refresh leaves behind
    ctx.registry.updateEffort(r.effort.id, { state: 'starting' });
    expect((await reapLeases(ctx)).reaped).toEqual([]);
    expect(ctx.registry.openEffortFor('demo', 'shop/cart')?.state).toBe('starting');

    const old = new Date(Date.now() - 31 * 60_000).toISOString();
    ctx.registry.updateEffort(r.effort.id, { started: old, lastActivity: old });
    await reapLeases(ctx);
    expect(ctx.registry.openEffortFor('demo', 'shop/cart')).toBeUndefined();
    const parked = ctx.registry.efforts({ project: 'demo', area: 'shop/cart', state: 'parked' });
    expect(parked).toHaveLength(1);
    expect(parked[0]?.parkedReason).toMatch(/start/i);
    // the area is free again
    const again = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    expect(again.effort.state).toBe('active');
  });
});

describe('W5: a slot whose port is held on a wildcard address is not free', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  for (const addr of ['0.0.0.0', '::']) {
    it(`skips a slot whose port is listened on ${addr}`, async () => {
      const f = makeRepo();
      cleanup = f.cleanup;
      const ctx = ctxFor(f);
      const busy = createServer().listen(43101, addr);
      await new Promise((res) => busy.once('listening', res));
      try {
        const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
        expect(r.leases[0]?.value).toBe(2);
      } finally {
        busy.close();
      }
    });
  }
});

const manifestSource = {
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

describe('W6: expired leases do not hold slots', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('start reaps expired leases first, and a genuine shortage names the way out', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const one = validateManifest({ ...manifestSource, slots: { count: 2, reserved: [0] } });
    const ctx = { ...ctxFor(f), manifest: one };
    const a = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    const lease = ctx.registry.leases({ effort: a.effort.id, kind: 'slot' })[0]!;
    ctx.registry.patchLease(lease.id, { expires: new Date(Date.now() - 60_000).toISOString() });

    const b = await startEffort(ctx, { area: 'shop/team', type: 'feature', mode: 'fullstack' });
    expect(b.leases[0]?.value).toBe(1);
    expect(
      ctx.registry.efforts({ project: 'demo', area: 'shop/cart', state: 'parked' }),
    ).toHaveLength(1);

    await expect(
      startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' }),
    ).rejects.toThrow(/work status|work finish|work reap/);
  });
});

describe('W9: promote claims its slot before it changes the effort', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('leaves mode and scopes untouched when no slot is free', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const one = validateManifest({ ...manifestSource, slots: { count: 2, reserved: [0] } });
    const ctx = { ...ctxFor(f), manifest: one };
    await startEffort(ctx, { area: 'shop/team', type: 'feature', mode: 'fullstack' });
    const fe = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });

    await expect(promoteEffort(ctx, { area: 'shop/cart', mode: 'fullstack' })).rejects.toThrow(
      /slot/i,
    );
    const after = ctx.registry.openEffortFor('demo', 'shop/cart');
    expect(after?.mode).toBe('frontend');
    expect(after?.scopes).toEqual(fe.effort.scopes);
    expect(ctx.registry.leases({ effort: fe.effort.id, kind: 'slot' })).toEqual([]);
  });
});

describe('W10: the database reset is owed until a start with a database runs it', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('a frontend start after a migration change does not consume the reset; the next fullstack start runs it', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const m = validateManifest({
      ...manifestSource,
      ports: {
        services: {
          frontend: { base: 43000 },
          backend: { base: 43100 },
          postgres: { base: 45400 },
        },
      },
      services: {
        ...manifestSource.services,
        postgres: { start: 'true', stop: 'true', health: 'true', reset: 'touch reset.marker' },
      },
      refresh: [{ when: 'migrations/**', mark: 'db-reset' }],
    });
    const ctx = { ...ctxFor(f), manifest: m };
    // a migration lands on develop before any effort on the area
    commitFile(f.main, 'migrations/V1.sql', 'create table t();', 'migration');
    new Git(f.main).push('develop');

    const fe = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    expect(existsSync(join(fe.effort.worktree, 'reset.marker'))).toBe(false);
    await finishEffort(ctx, { area: 'shop/cart' });

    const fs = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    expect(existsSync(join(fs.effort.worktree, 'reset.marker'))).toBe(true);
  });
});

describe('W11: a refused retire changes nothing', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('does not bring Storybook down before the dirty/unpushed checks', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const sb = fakeSb();
    const ctx = ctxFor(f, fakeRunner(), sb);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'fullstack' });
    await finishEffort(ctx, { area: 'shop/cart' });
    sb.downHosts.length = 0;
    writeFileSync(join(r.effort.worktree, 'dirty.txt'), 'x');

    await expect(retireArea(ctx, { area: 'shop/cart' })).rejects.toThrow(/uncommitted/);
    expect(sb.downHosts).toEqual([]);
  });
});

describe('W12: finish --into-area targets the area branch that exists', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('merges a fix task into the feature area branch instead of inventing fix/<area>', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const area = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(area.effort.worktree, 'app-ui/app/shop/cart/a.tsx', 'a', 'area work');
    await finishEffort(ctx, { area: 'shop/cart' });

    const task = await startEffort(ctx, {
      area: 'shop/cart',
      task: 'hotfix',
      type: 'fix',
      mode: 'backend',
    });
    commitFile(task.effort.worktree, 'svc/cart/fix.ts', 'f', 'the fix');
    const done = await finishEffort(ctx, { area: 'shop/cart', task: 'hotfix', intoArea: true });
    expect(done.mergedIntoArea).toBe(true);

    const main = new Git(f.main);
    expect(main.branchExists('fix/shop/cart')).toBe(false);
    expect(main.run(['log', '--format=%s', 'feature/shop/cart', '-n', '5'])).toContain('the fix');
  });
});

describe('§3.5: storybrokr sweeps', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('a backend effort never calls downHost at finish, reap or retire', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const sb = fakeSb();
    const ctx = ctxFor(f, fakeRunner(), sb);
    await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'backend' });
    await finishEffort(ctx, { area: 'shop/cart' });
    await retireArea(ctx, { area: 'shop/cart' });
    expect(sb.downHosts).toEqual([]);
  });
});

describe('§18.3 work pr', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  async function started(f: { main: string }, pritty = fakePritty()) {
    const ctx = ctxFor(f, fakeRunner(), fakeSb(), pritty);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(r.effort.worktree, 'app-ui/app/shop/cart/a.tsx', 'a', 'feat(cart): a');
    return { ctx, r };
  }

  it('refuses a dirty worktree before anything is pushed or asked of pritty', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { ctx, r } = await started(f);
    writeFileSync(join(r.effort.worktree, 'dirty.txt'), 'x');
    await expect(prEffort(ctx, { area: 'shop/cart', title: 't' })).rejects.toMatchObject({
      code: 'DIRTY_WORKTREE',
    });
    expect(ctx.pritty.calls).toEqual([]);
    expect(new Git(f.main).remoteBranchExists('feature/shop/cart')).toBe(false);
  });

  it('pushes first, then runs pritty with --no-push, the manifest base, the given words, and stores the PR', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { ctx, r } = await started(f);
    const out = await prEffort(ctx, {
      area: 'shop/cart',
      title: 'feat(cart): a',
      bodyFile: '/tmp/body.md',
      draft: true,
    });
    expect(new Git(f.main).remoteBranchExists('feature/shop/cart')).toBe(true);
    expect(ctx.pritty.calls.map((c) => c.kind)).toEqual(['pr']);
    expect(ctx.pritty.calls[0]?.o).toMatchObject({
      cwd: r.effort.worktree,
      base: 'develop',
      title: 'feat(cart): a',
      bodyFile: '/tmp/body.md',
      draft: true,
    });
    expect(out.created).toBe(true);
    expect(out.pr).toMatchObject({ number: 101, draft: true });
    expect(ctx.registry.openEffortFor('demo', 'shop/cart')?.pr).toEqual(out.pr);
    expect(statusFor(ctx, 'shop/cart').areas[0]?.effort?.pr).toEqual(out.pr);
  });

  it('a second call returns the stored open PR without creating another; given words update it in place', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { ctx } = await started(f);
    const first = await prEffort(ctx, { area: 'shop/cart', title: 't', body: 'b' });
    ctx.pritty.calls.length = 0;
    const again = await prEffort(ctx, { area: 'shop/cart' });
    expect(again).toMatchObject({ created: false, pr: first.pr });
    expect(ctx.pritty.calls.map((c) => c.kind)).toEqual(['check']);
    ctx.pritty.calls.length = 0;
    const updated = await prEffort(ctx, { area: 'shop/cart', title: 'new title' });
    expect(updated.created).toBe(false);
    expect(ctx.pritty.calls.map((c) => c.kind)).toEqual(['check', 'pr']);
  });

  it('a stored PR that is no longer open is refused with PR_CLOSED unless --force', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { ctx } = await started(f);
    const first = await prEffort(ctx, { area: 'shop/cart', title: 't', body: 'b' });
    ctx.pritty.open = null; // merged on GitHub
    ctx.pritty.last = { number: first.pr.number, url: first.pr.url, state: 'MERGED' };
    await expect(
      prEffort(ctx, { area: 'shop/cart', title: 't2', body: 'b' }),
    ).rejects.toMatchObject({
      code: 'PR_CLOSED',
      message: expect.stringMatching(/was merged/),
    });
    ctx.pritty.last = { number: first.pr.number, url: first.pr.url, state: 'CLOSED' };
    await expect(
      prEffort(ctx, { area: 'shop/cart', title: 't2', body: 'b' }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/was closed without merging/) });
    const forced = await prEffort(ctx, { area: 'shop/cart', title: 't2', body: 'b', force: true });
    expect(forced.created).toBe(true);
    expect(forced.pr.number).not.toBe(first.pr.number);
    expect(ctx.registry.openEffortFor('demo', 'shop/cart')?.pr?.number).toBe(forced.pr.number);
  });

  it('warns, without refusing, when the branch is far behind the base', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { ctx } = await started(f);
    for (let i = 0; i < 21; i++) commitFile(f.main, `base-${i}.txt`, String(i), `base ${i}`);
    new Git(f.main).push('develop');
    const out = await prEffort(ctx, { area: 'shop/cart', title: 't', body: 'b' });
    expect(out.behindBase).toBeGreaterThan(20);
    expect(out.warnings.join('\n')).toMatch(/behind/);
    expect(out.created).toBe(true);
  });

  it('refuses a pritty below 0.1.2 before touching anything', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { ctx } = await started(f, fakePritty('0.1.1'));
    await expect(prEffort(ctx, { area: 'shop/cart', title: 't' })).rejects.toMatchObject({
      code: 'PRITTY_FAILED',
    });
    expect(new Git(f.main).remoteBranchExists('feature/shop/cart')).toBe(false);
  });

  it('finds the effort from a cwd inside its worktree when no area is given', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { ctx, r } = await started(f);
    const out = await prEffort(ctx, {
      cwd: join(r.effort.worktree, 'app-ui'),
      title: 't',
      body: 'b',
    });
    expect(out.effort.area).toBe('shop/cart');
    await expect(prEffort(ctx, { cwd: f.main, title: 't' })).rejects.toMatchObject({
      code: 'EFFORT_NOT_FOUND',
    });
  });
});

describe('finish and retire branch hygiene', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('finish does not push a branch with no commits of its own, and pushes once it has some', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const main = new Git(f.main);
    await startEffort(ctx, { area: 'shop/cart', type: 'chore', mode: 'frontend' });
    const empty = await finishEffort(ctx, { area: 'shop/cart' });
    expect(empty.pushed).toBe(false);
    expect(main.remoteBranchExists('chore/shop/cart')).toBe(false);

    const again = await startEffort(ctx, { area: 'shop/cart', type: 'chore', mode: 'frontend' });
    commitFile(again.effort.worktree, 'app-ui/app/shop/cart/a.tsx', 'a', 'cart work');
    const done = await finishEffort(ctx, { area: 'shop/cart' });
    expect(done.pushed).toBe(true);
    expect(main.remoteBranchExists('chore/shop/cart')).toBe(true);
  });

  it('retire deletes a local branch that is merged into the base even when GitHub removed the remote, and keeps an unmerged one', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const { gitIn } = await import('../core/testing/fixture-repo.js');
    const ctx = ctxFor(f);
    const main = new Git(f.main);
    const r = await startEffort(ctx, { area: 'shop/cart', type: 'feature', mode: 'frontend' });
    commitFile(r.effort.worktree, 'app-ui/app/shop/cart/a.tsx', 'a', 'cart work');
    await finishEffort(ctx, { area: 'shop/cart' });
    // the PR merges (merge commit) and GitHub auto-deletes the remote branch
    gitIn(f.main, 'merge', '-q', '--no-ff', '-m', 'Merge feature/shop/cart', 'feature/shop/cart');
    main.push('develop');
    gitIn(f.main, 'push', '-q', 'origin', '--delete', 'feature/shop/cart');

    const out = await retireArea(ctx, { area: 'shop/cart' });
    expect(out.branchesDeleted).toEqual(['feature/shop/cart']);
    expect(main.branchExists('feature/shop/cart')).toBe(false);

    // unmerged work whose remote is gone is on neither origin nor the base: retire refuses
    const t = await startEffort(ctx, { area: 'shop/team', type: 'feature', mode: 'frontend' });
    commitFile(t.effort.worktree, 'app-ui/app/shop/team/b.tsx', 'b', 'team work');
    await finishEffort(ctx, { area: 'shop/team' });
    gitIn(f.main, 'push', '-q', 'origin', '--delete', 'feature/shop/team');
    await expect(retireArea(ctx, { area: 'shop/team' })).rejects.toMatchObject({
      code: 'UNPUSHED',
    });
    expect(main.branchExists('feature/shop/team')).toBe(true);
  });
});

describe('notices and retire', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('retiring an area clears the notices its branches left on other areas, and the ones it received', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const ctx = ctxFor(f);
    const a = await startEffort(ctx, { area: 'platform/auth', type: 'chore', mode: 'frontend' });
    commitFile(a.effort.worktree, 'api/auth/x.ts', 'x', 'auth change');
    const done = await finishEffort(ctx, { area: 'platform/auth' });
    expect(done.notices).toBeGreaterThan(0);
    const cartBefore = statusFor(ctx).areas.find((x) => x.area === 'shop/cart')?.notices ?? [];
    expect(cartBefore).toHaveLength(1);
    // and platform/auth itself received one from another branch
    ctx.registry.addNotice('demo', 'platform/auth', {
      from: 'feature/shop/team',
      text: 'x',
      at: new Date().toISOString(),
    });

    await retireArea(ctx, { area: 'platform/auth' });

    const after = statusFor(ctx);
    expect(after.areas.find((x) => x.area === 'shop/cart')?.notices).toEqual([]);
    expect(after.areas.find((x) => x.area === 'shop/team')?.notices).toEqual([]);
    expect(after.areas.find((x) => x.area === 'platform/auth')?.notices).toEqual([]);
  });
});
