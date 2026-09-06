// src/server/broker.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configDirFor, instanceId } from '../lib/instance.js';
import { commandSpawner, type Spawner } from '../lib/spawn.js';
import type { HostInfo } from '../types.js';
import { Broker } from './broker.js';
import { DEFAULT_CONFIG } from './config.js';
import { Registry } from './registry.js';

/** A fake host with one component that imports a child; both have stories. */
function fakeHost(): string {
  const root = mkdtempSync(join(tmpdir(), 'sb-broker-'));
  mkdirSync(join(root, '.storybook'));
  writeFileSync(
    join(root, '.storybook', 'main.ts'),
    "export default { framework: '@storybook/react-vite', stories: [] };\n",
  );
  writeFileSync(join(root, '.storybook', 'preview.ts'), 'export default {};\n');
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '.bin', 'storybook'), '');
  mkdirSync(join(root, 'src', 'Button'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'Button', 'Button.tsx'),
    "import '../Icon/Icon';\nexport const Button = 1;\n",
  );
  writeFileSync(join(root, 'src', 'Button', 'Button.stories.tsx'), '');
  mkdirSync(join(root, 'src', 'Icon'));
  writeFileSync(join(root, 'src', 'Icon', 'Icon.tsx'), 'export const Icon = 1;\n');
  writeFileSync(join(root, 'src', 'Icon', 'Icon.stories.tsx'), '');
  return root;
}

/** Fake storybook: reads PORT from argv via the spawner's args, serves index.json, prints the banner. */
const FAKE_SB = `
const http = require('node:http');
const port = Number(process.env.SB_PORT);
http.createServer((req, res) => {
  if (req.url === '/index.json') { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({ v: 5, entries: { 'button--primary': { id: 'button--primary', type: 'story', title: 'Button', name: 'Primary', importPath: './src/Button/Button.stories.tsx' } } })); }
  else { res.writeHead(200); res.end('<html></html>'); }
}).listen(port, '127.0.0.1', () => console.log('  - Local:   http://localhost:' + port + '/'));
setInterval(() => {}, 1000);
`;

/** Wraps commandSpawner so the fake gets its port through SB_PORT. */
function fakeSpawner(): Spawner {
  return {
    spawn(host: HostInfo, configDir: string, port: number) {
      const inner = commandSpawner(process.execPath, ['-e', FAKE_SB]);
      process.env.SB_PORT = String(port);
      return inner.spawn(host, configDir, port);
    },
  };
}

/** Like FAKE_SB, but only starts listening (and printing the banner) after 1500 ms. */
const SLOW_FAKE_SB = `
const http = require('node:http');
const port = Number(process.env.SB_PORT);
setTimeout(() => {
  http.createServer((req, res) => {
    if (req.url === '/index.json') { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({ v: 5, entries: {} })); }
    else { res.writeHead(200); res.end('<html></html>'); }
  }).listen(port, '127.0.0.1', () => console.log('  - Local:   http://localhost:' + port + '/'));
}, 1500);
setInterval(() => {}, 1000);
`;

function slowFakeSpawner(): Spawner {
  return {
    spawn(host: HostInfo, configDir: string, port: number) {
      const inner = commandSpawner(process.execPath, ['-e', SLOW_FAKE_SB]);
      process.env.SB_PORT = String(port);
      return inner.spawn(host, configDir, port);
    },
  };
}

describe('Broker', () => {
  const dirs: string[] = [];
  const brokers: Broker[] = [];
  afterEach(async () => {
    for (const b of brokers) await b.downAll();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    brokers.length = 0;
  });

  function make(configOverrides = {}, now: () => Date = () => new Date()) {
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    dirs.push(home);
    const config = {
      ...DEFAULT_CONFIG,
      portRangeStart: 6150,
      portRangeEnd: 6159,
      readinessTimeoutMs: 10_000,
      ...configOverrides,
    };
    const registry = new Registry({ home, config, now });
    const broker = new Broker({ registry, spawner: fakeSpawner(), config, now });
    brokers.push(broker);
    return { broker, registry };
  }

  it('up discovers stories, spawns, waits for readiness, and returns a ready record with story URLs', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make();
    const { record, created } = await broker.up({ component: 'src/Button', hostRoot: host });
    expect(created).toBe(true);
    expect(record.status).toBe('ready');
    expect(record.port).toBe(6150);
    expect(record.storyFiles).toEqual([
      'src/Button/Button.stories.tsx',
      'src/Icon/Icon.stories.tsx',
    ]);
    expect(record.stories[0].iframeUrl).toBe(
      'http://127.0.0.1:6150/iframe.html?id=button--primary&viewMode=story',
    );
    expect(record.configDir).toBe(join(host, 'node_modules', '.cache', 'storybrokr', record.id));
  });

  it('a second up for the same component returns the same instance without spawning', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make();
    const first = await broker.up({ component: 'src/Button', hostRoot: host });
    const second = await broker.up({ component: 'src/Button', hostRoot: host });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(broker.list()).toHaveLength(1);
  });

  it('down stops the process and removes the config dir; reapIdle stops idle ones', async () => {
    const host = fakeHost();
    dirs.push(host);
    let now = new Date();
    const { broker } = make({ ttlMinutes: 1 }, () => now);
    const { record } = await broker.up({ component: 'src/Button', hostRoot: host });
    now = new Date(now.getTime() + 2 * 60_000);
    const reaped = await broker.reapIdle();
    expect(reaped.map((r) => r.id)).toEqual([record.id]);
    expect(broker.list().filter((r) => r.status === 'ready')).toEqual([]);
  });

  it('marks BOOT_FAILED with a log tail when the process dies', async () => {
    const host = fakeHost();
    dirs.push(host);
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    dirs.push(home);
    const config = { ...DEFAULT_CONFIG, portRangeStart: 6160, portRangeEnd: 6161 };
    const registry = new Registry({ home, config });
    const broker = new Broker({
      registry,
      spawner: commandSpawner(process.execPath, [
        '-e',
        'console.error("Error: Failed to load config"); process.exit(1)',
      ]),
      config,
    });
    brokers.push(broker);
    await expect(broker.up({ component: 'src/Button', hostRoot: host })).rejects.toMatchObject({
      code: 'BOOT_FAILED',
    });
    expect(broker.list()[0]).toMatchObject({ status: 'failed', error: { code: 'BOOT_FAILED' } });
  });

  it('serializes two concurrent up() calls for the same new component into one spawn', async () => {
    const host = fakeHost();
    dirs.push(host);
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    dirs.push(home);
    const config = {
      ...DEFAULT_CONFIG,
      portRangeStart: 6162,
      portRangeEnd: 6163,
      readinessTimeoutMs: 10_000,
    };
    const registry = new Registry({ home, config });
    let spawnCount = 0;
    const base = fakeSpawner();
    const countingSpawner: Spawner = {
      spawn(hostInfo: HostInfo, configDir: string, port: number) {
        spawnCount += 1;
        return base.spawn(hostInfo, configDir, port);
      },
    };
    const broker = new Broker({ registry, spawner: countingSpawner, config });
    brokers.push(broker);

    const [first, second] = await Promise.all([
      broker.up({ component: 'src/Button', hostRoot: host }),
      broker.up({ component: 'src/Button', hostRoot: host }),
    ]);

    expect(spawnCount).toBe(1);
    expect(first.record.id).toBe(second.record.id);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect(broker.list()).toHaveLength(1);
    expect(registry.portsInUse().size).toBe(1);
  });

  it('touch resolves a component path to its record and returns it by id', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make({ portRangeStart: 6164, portRangeEnd: 6165 });
    const { record } = await broker.up({ component: 'src/Button', hostRoot: host });
    const touched = broker.touch('src/Button');
    expect(touched.id).toBe(record.id);
  });

  it('reading logs refreshes lastTouchedAt', async () => {
    const host = fakeHost();
    dirs.push(host);
    let now = new Date();
    const { broker } = make({ portRangeStart: 6166, portRangeEnd: 6167 }, () => now);
    const { record } = await broker.up({ component: 'src/Button', hostRoot: host });
    now = new Date(now.getTime() + 5 * 60_000);
    broker.logs(record.id);
    expect(broker.get(record.id).lastTouchedAt).toBe(now.toISOString());
  });

  it('normalizes component paths (./ prefix, absolute) and rejects paths outside the host', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make({ portRangeStart: 6168, portRangeEnd: 6169 });
    const first = await broker.up({ component: 'src/Button', hostRoot: host });
    const second = await broker.up({ component: './src/Button/', hostRoot: host });
    const third = await broker.up({ component: join(host, 'src/Button'), hostRoot: host });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(third.created).toBe(false);
    expect(third.record.id).toBe(first.record.id);
    await expect(broker.up({ component: '../outside', hostRoot: host })).rejects.toMatchObject({
      code: 'COMPONENT_NOT_FOUND',
    });
  });

  it('down before readiness reports BOOT_FAILED rather than INSTANCE_NOT_FOUND', async () => {
    const host = fakeHost();
    dirs.push(host);
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    dirs.push(home);
    const config = {
      ...DEFAULT_CONFIG,
      portRangeStart: 6170,
      portRangeEnd: 6171,
      readinessTimeoutMs: 10_000,
    };
    const registry = new Registry({ home, config });
    const broker = new Broker({ registry, spawner: slowFakeSpawner(), config });
    brokers.push(broker);

    const id = instanceId(host, 'src/Button');
    const p = broker.up({ component: 'src/Button', hostRoot: host });
    await new Promise((r) => setTimeout(r, 200));
    await broker.down(id);

    await expect(p).rejects.toMatchObject({ code: 'BOOT_FAILED' });
    expect(broker.list()).toEqual([]);
  });

  it('enforces the instance cap before writing any config dir for the request that would exceed it', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make({ instanceCap: 1, portRangeStart: 6172, portRangeEnd: 6173 });
    await broker.up({ component: 'src/Button', hostRoot: host });
    await expect(broker.up({ component: 'src/Icon', hostRoot: host })).rejects.toMatchObject({
      code: 'INSTANCE_CAP_REACHED',
    });
    expect(existsSync(configDirFor(host, instanceId(host, 'src/Icon')))).toBe(false);
  });

  it('wait:false on a new component returns the starting record immediately, and a later up waits for readiness', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make({ portRangeStart: 6174, portRangeEnd: 6175 });

    const first = await broker.up({ component: 'src/Button', hostRoot: host, wait: false });
    expect(first.created).toBe(true);
    expect(first.record.id).toBe(instanceId(host, 'src/Button'));
    expect(first.record.status).toBe('starting');

    const second = await broker.up({ component: 'src/Button', hostRoot: host });
    expect(second.created).toBe(false);
    expect(second.record.status).toBe('ready');
    expect(second.record.stories.length).toBe(1);
  });

  it('a concurrent wait:false caller during an in-flight creation gets a defined record', async () => {
    const host = fakeHost();
    dirs.push(host);
    const { broker } = make({ portRangeStart: 6174, portRangeEnd: 6175 });

    const [a, b] = await Promise.all([
      broker.up({ component: 'src/Button', hostRoot: host, wait: true }),
      broker.up({ component: 'src/Button', hostRoot: host, wait: false }),
    ]);

    expect(b.record).toBeDefined();
    expect(b.record.id).toBe(a.record.id);
    expect(a.record.status).toBe('ready');
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
  });

  it('a wait:false boot failure is recorded without an unhandled rejection', async () => {
    const host = fakeHost();
    dirs.push(host);
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    dirs.push(home);
    const config = { ...DEFAULT_CONFIG, portRangeStart: 6176, portRangeEnd: 6177 };
    const registry = new Registry({ home, config });
    const broker = new Broker({
      registry,
      spawner: commandSpawner(process.execPath, [
        '-e',
        'console.error("Error: Failed to load config"); process.exit(1)',
      ]),
      config,
    });
    brokers.push(broker);

    let unhandled: unknown;
    const onUnhandled = (err: unknown) => {
      unhandled = err;
    };
    process.once('unhandledRejection', onUnhandled);
    try {
      const r = await broker.up({ component: 'src/Button', hostRoot: host, wait: false });
      expect(r.record.status).toBe('starting');

      const deadline = Date.now() + 3000;
      while (broker.list()[0]?.status === 'starting' && Date.now() < deadline) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, 50));
      }
      expect(broker.list()[0]).toMatchObject({ status: 'failed', error: { code: 'BOOT_FAILED' } });

      // Give a microtask/macrotask turn for a would-be unhandledRejection to surface.
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 0));
      expect(unhandled).toBeUndefined();
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });
});
