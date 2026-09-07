import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { type ErrorBody, httpStatusFor, StorybrokrError, toErrorBody } from '../lib/errors.js';
import type { Broker } from './broker.js';
import type { Inspector } from './inspector.js';

const UpBody = z.object({
  component: z.string().min(1),
  hostRoot: z.string().min(1).optional(),
  ttlMinutes: z.number().min(0).optional(),
  wait: z.boolean().optional(),
});

const InspectBody = z.object({ path: z.string().min(1) });

const WaitForBody = z.union([
  z.object({ selector: z.string().min(1) }),
  z.object({ text: z.string().min(1) }),
]);
const TimeoutMs = z.number().int().min(1000).max(300_000).optional();

const CheckBody = z.object({
  storyIds: z.array(z.string().min(1)).min(1).optional(),
  waitFor: WaitForBody.optional(),
  timeoutMs: TimeoutMs,
});

const ScreenshotBody = z.object({
  storyId: z.string().min(1),
  outPath: z.string().min(1).refine(isAbsolute, { message: 'must be an absolute path' }).optional(),
  viewport: z
    .object({
      width: z.number().int().min(1).max(10_000),
      height: z.number().int().min(1).max(10_000),
    })
    .optional(),
  clip: z.enum(['root', 'viewport', 'page']).optional(),
  waitFor: WaitForBody.optional(),
  timeoutMs: TimeoutMs,
});

/** Validates a parsed JSON body against a zod schema, mapping a failure to BAD_REQUEST instead
 * of letting an unvalidated shape reach the broker (e.g. `{}` → TypeError → 500). */
function parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
    throw new StorybrokrError('BAD_REQUEST', `invalid request body: ${path}: ${issue.message}`);
  }
  return result.data;
}

export interface RouteContext {
  broker: Broker;
  inspector: Inspector;
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
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new StorybrokrError('BAD_REQUEST', 'invalid JSON body');
  }
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
    if (parts[0] !== 'v1') {
      const body: ErrorBody = { code: 'NOT_FOUND', message: 'unknown route' };
      return send(res, httpStatusFor(body.code), body);
    }

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
        const body = parseBody(UpBody, await readJson(req));
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
      if (parts.length === 4 && parts[3] === 'check' && method === 'POST') {
        const body = parseBody(CheckBody, await readJson(req));
        const record = ctx.broker.get(id); // touches the instance
        return send(res, 200, await ctx.inspector.check(record, body));
      }
      if (parts.length === 4 && parts[3] === 'screenshot' && method === 'POST') {
        const body = parseBody(ScreenshotBody, await readJson(req));
        const record = ctx.broker.get(id);
        return send(res, 200, await ctx.inspector.screenshot(record, body));
      }
      if (parts.length === 4 && parts[3] === 'logs' && method === 'GET') {
        const rawTail = Number(url.searchParams.get('tail') ?? '200');
        const tail = Number.isInteger(rawTail) && rawTail > 0 ? rawTail : 200;
        if (url.searchParams.get('follow') !== '1')
          return send(res, 200, { lines: ctx.broker.logs(id, tail) });
        // Resolved once, up front: a path-shaped `id` needs the real instance id for the
        // liveness poll below, and this touches the record (fine for a log read).
        const resolvedId = ctx.broker.get(id).id;
        const stream = ctx.broker.logStream(id);
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        // Without an explicit flush, Node holds the headers back until the first body write —
        // a client awaiting the response (to confirm the stream is live) would hang until a
        // log line actually arrives.
        res.flushHeaders();
        for (const line of ctx.broker.logs(id, tail))
          res.write(`data: ${JSON.stringify(line)}\n\n`);
        if (!stream) {
          // No live process to follow (e.g. an adopted instance with no local log stream) —
          // the tail is everything there is; end the stream instead of hanging forever.
          res.end();
          return;
        }
        const off = stream.onLine((line) => res.write(`data: ${JSON.stringify(line)}\n\n`));
        const ACTIVE = new Set(['starting', 'ready']);
        const poll = setInterval(() => {
          const record = ctx.broker.list().find((r) => r.id === resolvedId);
          if (!record || !ACTIVE.has(record.status)) {
            clearInterval(poll);
            off();
            res.end();
          }
        }, 500);
        req.on('close', () => {
          clearInterval(poll);
          off();
        });
        return;
      }
    }
    if (parts[1] === 'hosts' && parts[2] === 'inspect' && method === 'POST') {
      const { path } = parseBody(InspectBody, await readJson(req));
      return send(res, 200, { host: ctx.broker.inspectHost(path) });
    }
    if (parts[1] === 'shutdown' && method === 'POST') {
      send(res, 202, { ok: true });
      setImmediate(ctx.shutdown);
      return;
    }
    const body: ErrorBody = {
      code: 'NOT_FOUND',
      message: `no route for ${method} ${url.pathname}`,
    };
    return send(res, httpStatusFor(body.code), body);
  } catch (err) {
    sendError(res, err);
  }
}
