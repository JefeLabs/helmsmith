import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import { LogBuffer } from '../lib/logbuffer.js';
import { daemonFile } from '../lib/paths.js';
import type { Spawner } from '../lib/spawn.js';
import { Broker } from '../server/broker.js';
import { DEFAULT_CONFIG } from '../server/config.js';
import { createDaemon, type Daemon } from '../server/daemon.js';
import { Registry } from '../server/registry.js';
import type { InstanceRecord } from '../types.js';
import { DaemonClient, resolveDaemonEntry } from './index.js';

const neverSpawner: Spawner = {
  spawn: () => {
    throw new Error('unexpected');
  },
};

function fakeDaemon(home: string): { registry: Registry; broker: Broker; daemon: Daemon } {
  const registry = new Registry({ home, config: DEFAULT_CONFIG });
  const broker = new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
  const daemon = createDaemon({ home, broker, config: DEFAULT_CONFIG });
  return { registry, broker, daemon };
}

describe('DaemonClient', () => {
  const homes: string[] = [];
  const daemons: Daemon[] = [];
  const servers: Server[] = [];
  const socketSets: Set<Socket>[] = [];
  afterEach(async () => {
    for (const d of daemons) await d.stop().catch(() => {});
    for (const sockets of socketSets) for (const s of sockets) s.destroy();
    for (const s of servers) await new Promise<void>((resolve) => s.close(() => resolve()));
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  it('connects via daemon.json, sends the token, and maps error bodies to StorybrokrError', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const { daemon } = fakeDaemon(home);
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
      const { daemon } = fakeDaemon(home);
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

  it('re-reads daemon.json and retries once when the token has rotated (401)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const { daemon: daemonA } = fakeDaemon(home);
    daemons.push(daemonA);
    const infoA = await daemonA.start(0);
    const client = await DaemonClient.connect({ home, autoStart: false });
    await daemonA.stop();
    const { daemon: daemonB } = fakeDaemon(home);
    daemons.push(daemonB);
    // Rebind to A's now-freed port so the client's stored URL is still valid — only the token
    // (written fresh into daemon.json by daemonB.start) differs.
    await daemonB.start(infoA.port);
    expect(await client.list()).toEqual([]);
  });

  it('maps a non-JSON error response to DAEMON_UNAVAILABLE instead of a bare SyntaxError', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const server = createServer((req, res) => {
      if (req.url === '/v1/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html>bad gateway</html>');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    writeFileSync(
      daemonFile(home),
      JSON.stringify({ port, token: 'tok', pid: process.pid, startedAt: new Date().toISOString() }),
    );
    const client = await DaemonClient.connect({ home, autoStart: false });
    await expect(client.list()).rejects.toMatchObject({ code: 'DAEMON_UNAVAILABLE' });
    await expect(client.list()).rejects.toThrow(/non-JSON 502/);
  });

  it('maps connection failures in up() and follow() to StorybrokrError DAEMON_UNAVAILABLE', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const { daemon } = fakeDaemon(home);
    daemons.push(daemon);
    await daemon.start(0);
    const client = await DaemonClient.connect({ home, autoStart: false });
    await daemon.stop();
    await expect(client.up({ component: 'x', hostRoot: '/h' })).rejects.toMatchObject({
      code: 'DAEMON_UNAVAILABLE',
    });
    await expect(client.follow('x', () => {})).rejects.toMatchObject({
      code: 'DAEMON_UNAVAILABLE',
    });
  });

  it('follow calls onEnd exactly once when the stream ends (e.g. via daemon.stop())', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const record: InstanceRecord = {
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
    };
    const { broker, daemon } = fakeDaemon(home);
    vi.spyOn(broker, 'get').mockReturnValue(record);
    vi.spyOn(broker, 'logs').mockReturnValue([]);
    const log = new LogBuffer();
    vi.spyOn(broker, 'logStream').mockReturnValue(log);
    daemons.push(daemon);
    await daemon.start(0);
    const client = await DaemonClient.connect({ home, autoStart: false });
    const onEnd = vi.fn();
    await client.follow('r1', () => {}, onEnd);
    await daemon.stop();
    const result = await Promise.race([
      (async () => {
        while (onEnd.mock.calls.length === 0) await new Promise((r) => setTimeout(r, 20));
        return 'ended' as const;
      })(),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3000)),
    ]);
    expect(result).toBe('ended');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('bounds the health probe so a hung daemon does not block connect()', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const sockets = new Set<Socket>();
    socketSets.push(sockets);
    const server = createServer(() => {
      // Deliberately never responds — simulates a hung daemon process.
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    writeFileSync(
      daemonFile(home),
      JSON.stringify({ port, token: 'tok', pid: process.pid, startedAt: new Date().toISOString() }),
    );
    const start = Date.now();
    await expect(DaemonClient.connect({ home, autoStart: false })).rejects.toMatchObject({
      code: 'DAEMON_UNAVAILABLE',
    });
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});

describe('resolveDaemonEntry', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('prefers the bundled entry next to the client when it exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'sb-entry-'));
    dirs.push(base);
    const fromDir = join(base, 'dist', 'client');
    mkdirSync(join(fromDir, 'server'), { recursive: true });
    const bundled = join(fromDir, 'server', 'start.js');
    writeFileSync(bundled, '');
    expect(resolveDaemonEntry(fromDir)).toBe(bundled);
  });

  it('falls back to the package-root dist layout two levels up when only that exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'sb-entry-'));
    dirs.push(base);
    const fromDir = join(base, 'src', 'client');
    mkdirSync(fromDir, { recursive: true });
    const dev = join(base, 'dist', 'server', 'start.js');
    mkdirSync(dirname(dev), { recursive: true });
    writeFileSync(dev, '');
    expect(resolveDaemonEntry(fromDir)).toBe(dev);
  });

  it('throws DAEMON_UNAVAILABLE pointing at pnpm build when neither entry exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'sb-entry-'));
    dirs.push(base);
    const fromDir = join(base, 'src', 'client');
    mkdirSync(fromDir, { recursive: true });
    expect(() => resolveDaemonEntry(fromDir)).toThrow(StorybrokrError);
    try {
      resolveDaemonEntry(fromDir);
      throw new Error('expected resolveDaemonEntry to throw');
    } catch (err) {
      expect(err).toMatchObject({ code: 'DAEMON_UNAVAILABLE' });
      expect((err as Error).message).toMatch(/pnpm build/);
    }
  });
});
