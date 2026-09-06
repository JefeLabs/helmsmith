import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { LogBuffer } from './logbuffer.js';
import { fetchStories, parseIndex, waitForReady } from './readiness.js';

const INDEX = {
  v: 5,
  entries: {
    'core-atoms-button--primary': {
      id: 'core-atoms-button--primary',
      type: 'story',
      title: 'Core/Atoms/Button',
      name: 'Primary',
      importPath: './src/Button.stories.tsx',
    },
    'core-atoms-button--docs': {
      id: 'core-atoms-button--docs',
      type: 'docs',
      title: 'Core/Atoms/Button',
      name: 'Docs',
      importPath: './src/Button.stories.tsx',
    },
  },
};

function serveIndex(port: number, ready: () => boolean): Promise<Server> {
  return new Promise((res) => {
    const s = createServer((req, r) => {
      if (req.url === '/index.json' && ready()) {
        r.writeHead(200, { 'content-type': 'application/json' });
        r.end(JSON.stringify(INDEX));
      } else {
        r.writeHead(503);
        r.end();
      }
    });
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

const never = new Promise<number | null>(() => {});

describe('readiness', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers.length = 0;
  });

  it('parseIndex keeps stories only and builds both URLs', () => {
    expect(parseIndex(INDEX, 6100)).toEqual([
      {
        id: 'core-atoms-button--primary',
        title: 'Core/Atoms/Button',
        name: 'Primary',
        importPath: './src/Button.stories.tsx',
        url: 'http://127.0.0.1:6100/?path=/story/core-atoms-button--primary',
        iframeUrl: 'http://127.0.0.1:6100/iframe.html?id=core-atoms-button--primary&viewMode=story',
      },
    ]);
  });

  it('resolves once the index answers and the banner has printed, in either order', async () => {
    let ready = false;
    servers.push(await serveIndex(6181, () => ready));
    const log = new LogBuffer();
    const p = waitForReady({ port: 6181, log, exited: never, timeoutMs: 5000, pollMs: 20 });
    log.push('│   - Local:   http://localhost:6181/   │\n');
    ready = true;
    const stories = await p;
    expect(stories).toHaveLength(1);
  });

  it('rejects BOOT_FAILED with a log tail when the process exits first', async () => {
    const log = new LogBuffer();
    log.push('Error: boom\n');
    const exited = Promise.resolve(1);
    await expect(
      waitForReady({ port: 6182, log, exited, timeoutMs: 5000, pollMs: 20 }),
    ).rejects.toMatchObject({
      code: 'BOOT_FAILED',
      logTail: ['Error: boom'],
    });
  });

  it('rejects BOOT_TIMEOUT when nothing becomes ready in time', async () => {
    const log = new LogBuffer();
    await expect(
      waitForReady({ port: 6183, log, exited: never, timeoutMs: 150, pollMs: 20 }),
    ).rejects.toMatchObject({
      code: 'BOOT_TIMEOUT',
    });
  });

  it('rejects BOOT_FAILED for a failure line logged before waitForReady was called', async () => {
    const log = new LogBuffer();
    log.push('SB_CORE-SERVER_0002: port 6184 is in use\n');
    await expect(
      waitForReady({ port: 6184, log, exited: never, timeoutMs: 5000, pollMs: 20 }),
    ).rejects.toMatchObject({
      code: 'BOOT_FAILED',
      logTail: ['SB_CORE-SERVER_0002: port 6184 is in use'],
    });
  });

  it('fetchStories times out instead of hanging when the server never responds', async () => {
    const sockets = new Set<Socket>();
    const server = createServer((_req, _res) => {
      // Deliberately never call res.end() to simulate a hung connection.
    });
    server.on('connection', (s) => sockets.add(s));
    await new Promise<void>((res) => server.listen(6185, '127.0.0.1', () => res()));
    try {
      const start = Date.now();
      const stories = await fetchStories(6185, 100);
      expect(stories).toBeNull();
      expect(Date.now() - start).toBeLessThan(1000);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    }
  });

  it('does not treat a broad "Error: Failed to" line as fatal', async () => {
    servers.push(await serveIndex(6186, () => true));
    const log = new LogBuffer();
    log.push('Error: Failed to fetch dynamically imported module ./Broken.stories.tsx\n');
    log.push('│   - Local:   http://localhost:6186/   │\n');
    const stories = await waitForReady({
      port: 6186,
      log,
      exited: never,
      timeoutMs: 5000,
      pollMs: 20,
    });
    expect(stories).toHaveLength(1);
  });
});
