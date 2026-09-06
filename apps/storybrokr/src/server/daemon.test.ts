import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
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
});
