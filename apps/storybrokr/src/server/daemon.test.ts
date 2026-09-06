import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import { LogBuffer } from '../lib/logbuffer.js';
import type { Spawner } from '../lib/spawn.js';
import type { InstanceRecord } from '../types.js';
import { Broker } from './broker.js';
import { DEFAULT_CONFIG } from './config.js';
import { createDaemon, type Daemon } from './daemon.js';
import { Registry } from './registry.js';

const neverSpawner: Spawner = {
  spawn: () => {
    throw new Error('spawn not expected');
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRecord(id = 'r1'): InstanceRecord {
  return {
    id,
    hostRoot: '/h',
    component: 'src/X',
    framework: 'x',
    port: 6100,
    url: 'http://127.0.0.1:6100',
    pid: 1,
    status: 'ready',
    createdAt: 'c',
    lastTouchedAt: 't',
    ttlMinutes: 30,
    storyFiles: [],
    stories: [],
    configDir: `/h/node_modules/.cache/storybrokr/${id}`,
  };
}

describe('daemon', () => {
  const homes: string[] = [];
  const daemons: Daemon[] = [];
  afterEach(async () => {
    for (const d of daemons) await d.stop().catch(() => {});
    daemons.length = 0;
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  async function boot(broker?: Broker) {
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const b = broker ?? new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const daemon = createDaemon({ home, broker: b, config: DEFAULT_CONFIG });
    daemons.push(daemon);
    const info = await daemon.start(0);
    return { home, daemon, info, broker: b };
  }

  it('writes daemon.json (0600) and the lock, serves health without a token, and rejects others without it', async () => {
    const { home, daemon, info } = await boot();
    expect(info.port).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'))).toMatchObject({
      port: info.port,
      token: daemon.token,
    });
    expect(statSync(join(home, 'daemon.json')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(home, 'daemon.lock'))).toBe(true);
    const health = await fetch(`${daemon.url}/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, instances: 0 });
    const noAuth = await fetch(`${daemon.url}/v1/instances`);
    expect(noAuth.status).toBe(401);
    expect(await noAuth.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('routes instances CRUD to the broker and maps error codes to statuses', async () => {
    const record = {
      id: 'r1',
      hostRoot: '/h',
      component: 'src/X',
      framework: 'x',
      port: 6100,
      url: 'http://127.0.0.1:6100',
      pid: 1,
      status: 'ready',
      createdAt: 'c',
      lastTouchedAt: 't',
      ttlMinutes: 30,
      storyFiles: [],
      stories: [],
      configDir: '/h/node_modules/.cache/storybrokr/r1',
    } as InstanceRecord;
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const broker = new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const up = vi.spyOn(broker, 'up').mockResolvedValue({ record, created: true });
    vi.spyOn(broker, 'list').mockReturnValue([record]);
    vi.spyOn(broker, 'get').mockImplementation((id) => {
      if (id === 'r1') return record;
      throw new StorybrokrError('INSTANCE_NOT_FOUND', 'nope');
    });
    const down = vi.spyOn(broker, 'down').mockResolvedValue();
    const { daemon } = await boot(broker);
    const h = { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' };

    const created = await fetch(`${daemon.url}/v1/instances`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ component: 'src/X', hostRoot: '/h' }),
    });
    expect(created.status).toBe(201);
    expect(up).toHaveBeenCalledWith({ component: 'src/X', hostRoot: '/h' });
    expect(((await created.json()) as { record: InstanceRecord }).record.id).toBe('r1');

    expect(
      (await (await fetch(`${daemon.url}/v1/instances`, { headers: h })).json()) as unknown,
    ).toEqual({ instances: [record] });
    expect((await fetch(`${daemon.url}/v1/instances/r1`, { headers: h })).status).toBe(200);
    const missing = await fetch(`${daemon.url}/v1/instances/zz`, { headers: h });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
    expect(
      (await fetch(`${daemon.url}/v1/instances/r1`, { method: 'DELETE', headers: h })).status,
    ).toBe(204);
    expect(down).toHaveBeenCalledWith('r1');
  });

  it('refuses to start twice on the same home while the lock holder is alive', async () => {
    const { home } = await boot();
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const second = createDaemon({
      home,
      broker: new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG }),
      config: DEFAULT_CONFIG,
    });
    await expect(second.start(0)).rejects.toThrow(/already running/);
  });

  it("a daemon that lost the lock race never touches the live daemon's files, and stop() is idempotent", async () => {
    const { home, daemon: daemonA } = await boot();
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const daemonB = createDaemon({
      home,
      broker: new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG }),
      config: DEFAULT_CONFIG,
    });
    await expect(daemonB.start(0)).rejects.toThrow(/already running/);
    await expect(daemonB.stop()).resolves.toBeUndefined();
    expect(existsSync(join(home, 'daemon.json'))).toBe(true);
    expect(existsSync(join(home, 'daemon.lock'))).toBe(true);
    const health = await fetch(`${daemonA.url}/v1/health`);
    expect(health.status).toBe(200);
    await expect(daemonA.stop()).resolves.toBeUndefined();
    await expect(daemonA.stop()).resolves.toBeUndefined();
  });

  it('reclaims a stale zero-length lock file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    writeFileSync(join(home, 'daemon.lock'), '');
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const daemon = createDaemon({
      home,
      broker: new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG }),
      config: DEFAULT_CONFIG,
    });
    daemons.push(daemon);
    await expect(daemon.start(0)).resolves.toMatchObject({ pid: process.pid });
    expect(readFileSync(join(home, 'daemon.lock'), 'utf8').trim()).toBe(String(process.pid));
  });

  it('closes idle SSE connections so shutdown does not hang', async () => {
    const record = makeRecord();
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const broker = new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    vi.spyOn(broker, 'get').mockReturnValue(record);
    vi.spyOn(broker, 'logs').mockReturnValue([]);
    const log = new LogBuffer();
    vi.spyOn(broker, 'logStream').mockReturnValue(log);
    const { daemon } = await boot(broker);
    const h = { authorization: `Bearer ${daemon.token}` };

    const res = await fetch(`${daemon.url}/v1/instances/r1/logs?follow=1`, { headers: h });
    const reader = res.body?.getReader();
    log.push('hello\n');
    await reader?.read();

    const result = await Promise.race([
      daemon.stop().then(() => 'stopped' as const),
      sleep(3000).then(() => 'timeout' as const),
    ]);
    expect(result).toBe('stopped');
  });

  it('returns typed error bodies for malformed JSON and unknown routes', async () => {
    const { daemon } = await boot();
    const h = { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' };

    const badJson = await fetch(`${daemon.url}/v1/instances`, {
      method: 'POST',
      headers: h,
      body: '{ not json',
    });
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toMatchObject({ code: 'BAD_REQUEST' });

    const notFound = await fetch(`${daemon.url}/v1/nope`, { headers: h });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('falls back to a default tail count when the query param is not a valid number', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const broker = new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const logs = vi.spyOn(broker, 'logs').mockReturnValue([]);
    const { daemon } = await boot(broker);
    const h = { authorization: `Bearer ${daemon.token}` };

    await fetch(`${daemon.url}/v1/instances/r1/logs?tail=abc`, { headers: h });
    expect(logs).toHaveBeenCalledWith('r1', 200);
  });

  it('normalizes daemon.json permissions to 0600 even if the file pre-existed with looser perms', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    writeFileSync(join(home, 'daemon.json'), '{}', { mode: 0o644 });
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const daemon = createDaemon({
      home,
      broker: new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG }),
      config: DEFAULT_CONFIG,
    });
    daemons.push(daemon);
    await daemon.start(0);
    expect(statSync(join(home, 'daemon.json')).mode & 0o777).toBe(0o600);
  });
});
