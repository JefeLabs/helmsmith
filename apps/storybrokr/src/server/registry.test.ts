import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import type { InstanceRecord } from '../types.js';
import { DEFAULT_CONFIG } from './config.js';
import { Registry } from './registry.js';

function rec(id: string, extra: Partial<InstanceRecord> = {}): InstanceRecord {
  return {
    id,
    hostRoot: '/h',
    component: `src/${id}`,
    framework: 'x',
    port: 6100,
    url: 'http://127.0.0.1:6100',
    pid: 1,
    status: 'ready',
    createdAt: '2026-09-06T00:00:00.000Z',
    lastTouchedAt: '2026-09-06T00:00:00.000Z',
    ttlMinutes: 30,
    storyFiles: [],
    stories: [],
    configDir: `/h/node_modules/.cache/storybrokr/${id}`,
    ...extra,
  };
}

describe('Registry', () => {
  const homes: string[] = [];
  const home = () => {
    const h = mkdtempSync(join(tmpdir(), 'sb-reg-'));
    homes.push(h);
    return h;
  };
  afterEach(() => {
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  it('adds, finds by host+component, resolves by id or path, and persists atomically', () => {
    const h = home();
    const reg = new Registry({ home: h, config: DEFAULT_CONFIG });
    reg.add(rec('a1'));
    expect(reg.find('/h', 'src/a1')?.id).toBe('a1');
    expect(reg.resolve('a1').id).toBe('a1');
    expect(reg.resolve('src/a1', '/h').id).toBe('a1');
    expect(() => reg.resolve('zzz')).toThrow(StorybrokrError);
    expect(existsSync(join(h, 'state.json'))).toBe(true);
    const again = new Registry({ home: h, config: DEFAULT_CONFIG });
    again.load();
    expect(again.list().map((r) => r.id)).toEqual(['a1']);
    expect(JSON.parse(readFileSync(join(h, 'state.json'), 'utf8')).instances).toHaveLength(1);
  });

  it('enforces the instance cap over starting+ready only', () => {
    const reg = new Registry({ home: home(), config: { ...DEFAULT_CONFIG, instanceCap: 2 } });
    reg.add(rec('a'));
    reg.add(rec('b', { status: 'starting', port: 6101 }));
    reg.add(rec('c', { status: 'failed', port: 6102 }));
    expect(() => reg.add(rec('d', { port: 6103 }))).toThrow(/INSTANCE_CAP_REACHED|cap/);
  });

  it('reports ports in use and idle instances relative to an injected clock', () => {
    let now = new Date('2026-09-06T01:00:00.000Z');
    const reg = new Registry({ home: home(), config: DEFAULT_CONFIG, now: () => now });
    reg.add(rec('a', { lastTouchedAt: '2026-09-06T00:00:00.000Z' })); // 60 min idle
    reg.add(rec('b', { port: 6101, lastTouchedAt: '2026-09-06T00:50:00.000Z' })); // 10 min idle
    reg.add(rec('c', { port: 6102, ttlMinutes: 0, lastTouchedAt: '2026-09-06T00:00:00.000Z' })); // pinned
    expect([...reg.portsInUse()].sort()).toEqual([6100, 6101, 6102]);
    expect(reg.idleInstances().map((r) => r.id)).toEqual(['a']);
    reg.touch('a');
    expect(reg.get('a')?.lastTouchedAt).toBe(now.toISOString());
    expect(reg.idleInstances()).toEqual([]);
    now = new Date('2026-09-06T03:00:00.000Z');
    expect(
      reg
        .idleInstances()
        .map((r) => r.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('update merges and remove drops', () => {
    const reg = new Registry({ home: home(), config: DEFAULT_CONFIG });
    reg.add(rec('a', { status: 'starting' }));
    expect(reg.update('a', { status: 'ready', pid: 42 })).toMatchObject({
      status: 'ready',
      pid: 42,
    });
    reg.remove('a');
    expect(reg.list()).toEqual([]);
  });

  it('discards malformed JSON in state.json', () => {
    const h = home();
    const stateFile = join(h, 'state.json');
    const fs = require('node:fs');
    fs.writeFileSync(stateFile, '{ not json');
    const reg = new Registry({ home: h, config: DEFAULT_CONFIG });
    expect(() => reg.load()).not.toThrow();
    expect(reg.list()).toEqual([]);
  });

  it('discards null in state.json', () => {
    const h = home();
    const stateFile = join(h, 'state.json');
    const fs = require('node:fs');
    fs.writeFileSync(stateFile, 'null');
    const reg = new Registry({ home: h, config: DEFAULT_CONFIG });
    expect(() => reg.load()).not.toThrow();
    expect(reg.list()).toEqual([]);
  });

  it('skips invalid entries when loading mixed valid and invalid records', () => {
    const h = home();
    const stateFile = join(h, 'state.json');
    const fs = require('node:fs');
    const validRecord = rec('ok');
    const state = {
      version: 1,
      instances: [validRecord, 'garbage', { noId: true }],
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    const reg = new Registry({ home: h, config: DEFAULT_CONFIG });
    reg.load();
    expect(reg.list().map((r) => r.id)).toEqual(['ok']);
  });
});
