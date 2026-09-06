import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { LogBuffer } from './logbuffer.js';
import { parseIndex, waitForReady } from './readiness.js';

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
});
