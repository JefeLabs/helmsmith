import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import type { Spawner } from '../lib/spawn.js';
import { Broker } from '../server/broker.js';
import { DEFAULT_CONFIG } from '../server/config.js';
import { createDaemon, type Daemon } from '../server/daemon.js';
import { Registry } from '../server/registry.js';
import { DaemonClient } from './index.js';

const neverSpawner: Spawner = {
  spawn: () => {
    throw new Error('unexpected');
  },
};

describe('DaemonClient', () => {
  const homes: string[] = [];
  const daemons: Daemon[] = [];
  afterEach(async () => {
    for (const d of daemons) await d.stop().catch(() => {});
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  it('connects via daemon.json, sends the token, and maps error bodies to StorybrokrError', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const broker = new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const daemon = createDaemon({ home, broker, config: DEFAULT_CONFIG });
    daemons.push(daemon);
    await daemon.start(0);
    const client = await DaemonClient.connect({ home, autoStart: false });
    expect((await client.health()).ok).toBe(true);
    expect(await client.list()).toEqual([]);
    await expect(client.get('nope')).rejects.toBeInstanceOf(StorybrokrError);
    await expect(client.get('nope')).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });

  it('auto-starts through the injected startCommand and then connects', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const startCommand = vi.fn(async () => {
      const registry = new Registry({ home, config: DEFAULT_CONFIG });
      const daemon = createDaemon({
        home,
        broker: new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG }),
        config: DEFAULT_CONFIG,
      });
      daemons.push(daemon);
      await daemon.start(0);
    });
    const client = await DaemonClient.connect({ home, startCommand });
    expect(startCommand).toHaveBeenCalledTimes(1);
    expect((await client.health()).ok).toBe(true);
  });

  it('fails with DAEMON_UNAVAILABLE when auto-start is off and nothing is listening', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    await expect(DaemonClient.connect({ home, autoStart: false })).rejects.toMatchObject({
      code: 'DAEMON_UNAVAILABLE',
    });
  });
});
