// src/server/broker.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
