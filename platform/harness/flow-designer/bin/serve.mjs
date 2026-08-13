/**
 * The published designer's server: static files from the built app +
 * the same `/harness` → HARNESS_URL proxy contract the dev server uses
 * (catalog-client.ts always talks to `/harness/...`; this keeps the
 * harness CORS-free). Plain Node, zero dependencies — what
 * `npx @helmsmith/flow-designer` runs.
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

export function createDesignerServer({ distDir, harnessUrl }) {
  return createServer((req, res) => {
    const url = req.url ?? '/';

    // ── /harness proxy (prefix stripped, method + body forwarded) ──
    if (url.startsWith('/harness/') || url === '/harness') {
      const target = harnessUrl.replace(/\/$/, '') + url.slice('/harness'.length);
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        fetch(target, {
          method: req.method,
          headers: {
            ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] } : {}),
            ...(req.headers['x-actor-role'] ? { 'x-actor-role': req.headers['x-actor-role'] } : {}),
            ...(req.headers['x-actor-id'] ? { 'x-actor-id': req.headers['x-actor-id'] } : {}),
          },
          ...(body.length > 0 ? { body } : {}),
        })
          .then(async (upstream) => {
            res.statusCode = upstream.status;
            const ct = upstream.headers.get('content-type');
            if (ct) res.setHeader('content-type', ct);
            res.end(Buffer.from(await upstream.arrayBuffer()));
          })
          .catch((err) => {
            // Detail goes to the operator's terminal; the CLIENT gets a
            // generic body — the internal target URL and error innards
            // are not for arbitrary browsers to read.
            console.error(`proxy: ${req.method} ${url} → ${target} failed: ${err.message}`);
            res.statusCode = 502;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'harness unreachable' }));
          });
      });
      return;
    }

    // ── static app (SPA fallback; traversal pinned inside dist) ──
    const clean = normalize(url.split('?')[0]).replace(/^(\.\.[/\\])+/, '');
    const candidate = join(distDir, clean);
    const filePath =
      candidate.startsWith(distDir) && extname(candidate) ? candidate : join(distDir, 'index.html');
    readFile(filePath)
      .then((data) => {
        res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
        res.end(data);
      })
      .catch(() =>
        readFile(join(distDir, 'index.html'))
          .then((data) => {
            res.setHeader('content-type', MIME['.html']);
            res.end(data);
          })
          .catch(() => {
            res.statusCode = 500;
            res.end('designer build missing');
          }),
      );
  });
}
