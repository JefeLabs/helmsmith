import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { registryFile } from './paths.js';
import { Registry } from './registry.js';
import { minimal } from './testing/manifests.js';

const owner = { session: 's1', pid: 1 };

describe('Registry', () => {
  const homes: string[] = [];
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), 'wk-reg-'));
    homes.push(h);
    return h;
  };
  afterEach(() => {
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  it('starts empty and persists projects across opens', () => {
    const h = home();
    const r = Registry.open(h);
    r.upsertProject('demo', { root: '/d', ranges: { frontend: { base: 3000, count: 10 } } });
    expect(Registry.open(h).project('demo')?.root).toBe('/d');
  });

  it('allocates the lowest free non-reserved slot and never a reserved one', () => {
    const r = Registry.open(home());
    const m = validateManifest(minimal);
    r.upsertProject('demo', { root: '/d', ranges: {} });
    const a = r.allocateSlot('demo', m, owner, 'e1');
    const b = r.allocateSlot('demo', m, owner, 'e2');
    expect([a.value, b.value]).toEqual([1, 2]);
    expect(a.ports).toEqual({ frontend: 3001, backend: 8444 });
    r.release(a.id);
    expect(r.allocateSlot('demo', m, owner, 'e3').value).toBe(1);
  });

  it('refuses when every slot is leased', () => {
    const r = Registry.open(home());
    const m = validateManifest({ ...minimal, slots: { count: 2, reserved: [0] } });
    r.upsertProject('demo', { root: '/d', ranges: {} });
    r.allocateSlot('demo', m, owner, 'e1');
    expect(() => r.allocateSlot('demo', m, owner, 'e2')).toThrow(/no free slot/i);
  });

  it('allocateSlot under contention hands out distinct slots', async () => {
    const h = home();
    const m = validateManifest(minimal);
    Registry.open(h).upsertProject('demo', { root: '/d', ranges: {} });
    const results = await Promise.all(
      Array.from(
        { length: 6 },
        (_, i) =>
          new Promise<number>((res) =>
            setTimeout(
              () => res(Registry.open(h).allocateSlot('demo', m, owner, `e${i}`).value as number),
              0,
            ),
          ),
      ),
    );
    expect(new Set(results).size).toBe(6);
  });

  it('lists expired leases by the clock it is given', () => {
    const r = Registry.open(home());
    const m = validateManifest(minimal);
    r.upsertProject('demo', { root: '/d', ranges: {} });
    const l = r.allocateSlot('demo', m, owner, 'e1');
    expect(r.expired(new Date(Date.parse(l.expires) - 1000))).toEqual([]);
    expect(r.expired(new Date(Date.parse(l.expires) + 1000)).map((x) => x.id)).toEqual([l.id]);
  });

  it('stores and patches efforts, and finds the active one per area', () => {
    const r = Registry.open(home());
    r.addEffort({
      id: 'e1',
      project: 'demo',
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      branch: 'feature/shop/cart',
      worktree: '/w',
      owner,
      state: 'active',
      scopes: [],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    expect(r.activeEffortFor('demo', 'shop/cart')?.id).toBe('e1');
    r.updateEffort('e1', { state: 'finished' });
    expect(r.activeEffortFor('demo', 'shop/cart')).toBeUndefined();
    expect(() => r.updateEffort('nope', {})).toThrow(/nope/);
  });

  it('refuses to touch a corrupt registry instead of replacing it', () => {
    const h = home();
    const r = Registry.open(h);
    r.upsertProject('keep-me', { root: '/k', ranges: {} });
    appendFileSync(registryFile(h), '{{{ junk');
    const before = readFileSync(registryFile(h), 'utf8');
    expect(() => r.upsertProject('other', { root: '/o', ranges: {} })).toThrow(
      /corrupt|registry\.json/,
    );
    expect(readFileSync(registryFile(h), 'utf8')).toBe(before);
    expect(() => r.read()).toThrow(/corrupt|registry\.json/);
  });

  it('keeps notices per area across efforts', () => {
    const r = Registry.open(home());
    r.addNotice('demo', 'shop/cart', {
      from: 'fix/platform/auth',
      text: 'commons auth changed',
      at: 'x',
    });
    expect(r.notices('demo', 'shop/cart')).toHaveLength(1);
    expect(r.notices('demo', 'shop/team')).toEqual([]);
  });

  it('treats a starting effort as open', () => {
    const r = Registry.open(home());
    r.addEffort({
      id: 'e1',
      project: 'demo',
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      branch: 'b',
      worktree: '/w',
      owner,
      state: 'starting',
      scopes: [],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    expect(r.openEffortFor('demo', 'shop/cart')?.id).toBe('e1');
    expect(r.activeEffortFor('demo', 'shop/cart')).toBeUndefined();
  });

  it('distinguishes area efforts from task sub-efforts and deduplicates/clears notices by source branch', () => {
    const r = Registry.open(home());
    r.addEffort({
      id: 'e_area',
      project: 'demo',
      area: 'shop/cart',
      type: 'feature',
      mode: 'frontend',
      branch: 'feature/shop/cart',
      worktree: '/w1',
      owner,
      state: 'active',
      scopes: [],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    r.addEffort({
      id: 'e_task',
      project: 'demo',
      area: 'shop/cart',
      task: 'api',
      type: 'feature',
      mode: 'backend',
      branch: 'feature/shop/cart--api',
      worktree: '/w2',
      owner,
      state: 'active',
      scopes: [],
      commons: [],
      leases: [],
      notices: [],
      started: 'x',
      lastActivity: 'x',
    });
    expect(r.openEffortFor('demo', 'shop/cart')?.id).toBe('e_area');
    expect(r.openEffortFor('demo', 'shop/cart', 'api')?.id).toBe('e_task');
    r.addNotice('demo', 'shop/team', { from: 'chore/org/team', text: 't1', at: '1' });
    r.addNotice('demo', 'shop/team', { from: 'chore/org/team', text: 't1', at: '2' });
    expect(r.notices('demo', 'shop/team')).toHaveLength(1);
    r.clearNoticesFrom('demo', ['chore/org/team']);
    expect(r.notices('demo', 'shop/team')).toEqual([]);
  });
});
