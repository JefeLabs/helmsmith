import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// The npx entry's server factory — plain JS so the published bin needs
// no build step; tested here like any other module.
// @ts-expect-error — untyped .mjs module, exercised structurally.
import { createDesignerServer } from '../bin/serve.mjs';

const servers: Server[] = [];
const listen = (srv: Server): Promise<number> =>
  new Promise((resolve) => {
    servers.push(srv);
    srv.listen(0, '127.0.0.1', () => resolve((srv.address() as AddressInfo).port));
  });

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

async function fakeDist(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'designer-dist-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>designer</title>');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

describe('npx designer server (bin/serve.mjs)', () => {
  it('serves the built app: index, assets with mime, SPA fallback', async () => {
    const dist = await fakeDist();
    const port = await listen(
      createDesignerServer({ distDir: dist, harnessUrl: 'http://127.0.0.1:1' }),
    );

    const index = await fetch(`http://127.0.0.1:${port}/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('designer');

    const asset = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');

    // Unknown paths fall back to index (SPA), never 404 the app shell.
    const fallback = await fetch(`http://127.0.0.1:${port}/some/route`);
    expect(await fallback.text()).toContain('designer');

    // Path traversal stays inside dist.
    const traversal = await fetch(`http://127.0.0.1:${port}/assets/../../etc/passwd`);
    expect(await traversal.text()).toContain('designer'); // fallback, not the file
  });

  it('proxies /harness/* to the target with prefix stripped, forwarding method and body', async () => {
    const seen: Array<{ method: string; url: string; body: string }> = [];
    const upstream = createHttpServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, echoed: body }));
      });
    });
    const upstreamPort = await listen(upstream);

    const dist = await fakeDist();
    const port = await listen(
      createDesignerServer({ distDir: dist, harnessUrl: `http://127.0.0.1:${upstreamPort}` }),
    );

    const put = await fetch(`http://127.0.0.1:${port}/harness/v1/catalog`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flows: [] }),
    });
    expect(put.status).toBe(200);
    expect((await put.json()).ok).toBe(true);
    expect(seen[0]).toMatchObject({ method: 'PUT', url: '/v1/catalog', body: '{"flows":[]}' });
  });

  it('reports an unreachable harness as 502, never crashing the app server', async () => {
    const dist = await fakeDist();
    const port = await listen(
      createDesignerServer({ distDir: dist, harnessUrl: 'http://127.0.0.1:9' }),
    );
    const r = await fetch(`http://127.0.0.1:${port}/harness/v1/catalog`);
    expect(r.status).toBe(502);
    // The app shell still serves after a proxy failure.
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
  });
});
