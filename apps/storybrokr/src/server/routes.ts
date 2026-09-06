import type { IncomingMessage, ServerResponse } from 'node:http';
import { httpStatusFor, toErrorBody } from '../lib/errors.js';
import type { UpRequest } from '../types.js';
import type { Broker } from './broker.js';

export interface RouteContext {
  broker: Broker;
  version: string;
  startedAt: number;
  pid: number;
  shutdown: () => void;
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function sendError(res: ServerResponse, err: unknown): void {
  const body = toErrorBody(err);
  send(res, httpStatusFor(body.code), body);
}

/** Dispatches one request. Auth has already been checked by the caller. */
export async function handle(
  ctx: RouteContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean); // ['v1', 'instances', ':id', 'logs']
  const method = req.method ?? 'GET';
  try {
    if (parts[0] !== 'v1') return send(res, 404, { code: 'NOT_FOUND', message: 'unknown route' });

    if (method === 'GET' && parts[1] === 'health' && parts.length === 2) {
      return send(res, 200, {
        ok: true,
        version: ctx.version,
        pid: ctx.pid,
        uptimeMs: Date.now() - ctx.startedAt,
        instances: ctx.broker.list().length,
      });
    }
    if (parts[1] === 'instances') {
      if (parts.length === 2 && method === 'POST') {
        const body = (await readJson(req)) as unknown as UpRequest;
        const { record, created } = await ctx.broker.up(body);
        return send(res, created ? 201 : 200, { record });
      }
      if (parts.length === 2 && method === 'GET')
        return send(res, 200, { instances: ctx.broker.list() });
      const id = decodeURIComponent(parts[2] ?? '');
      if (parts.length === 3 && method === 'GET')
        return send(res, 200, { record: ctx.broker.get(id) });
      if (parts.length === 3 && method === 'DELETE') {
        await ctx.broker.down(id);
        return send(res, 204);
      }
      if (parts.length === 4 && parts[3] === 'touch' && method === 'POST')
        return send(res, 200, { record: ctx.broker.touch(id) });
      if (parts.length === 4 && parts[3] === 'logs' && method === 'GET') {
        const tail = Number(url.searchParams.get('tail') ?? '200');
        if (url.searchParams.get('follow') !== '1')
          return send(res, 200, { lines: ctx.broker.logs(id, tail) });
        const stream = ctx.broker.logStream(id);
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        for (const line of ctx.broker.logs(id, tail))
          res.write(`data: ${JSON.stringify(line)}\n\n`);
        const off = stream?.onLine((line) => res.write(`data: ${JSON.stringify(line)}\n\n`));
        req.on('close', () => off?.());
        return;
      }
    }
    if (parts[1] === 'hosts' && parts[2] === 'inspect' && method === 'POST') {
      const { path } = await readJson(req);
      return send(res, 200, { host: ctx.broker.inspectHost(String(path)) });
    }
    if (parts[1] === 'shutdown' && method === 'POST') {
      send(res, 202, { ok: true });
      setImmediate(ctx.shutdown);
      return;
    }
    return send(res, 404, { code: 'NOT_FOUND', message: `no route for ${method} ${url.pathname}` });
  } catch (err) {
    sendError(res, err);
  }
}
