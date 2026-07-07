/**
 * The tracker's HTTP surface (node:http, zero deps):
 *
 *   POST /figma-webhook  ← Figma team webhooks (passcode-verified)
 *   POST /presence       ← sentinel plugin snapshots of figma.activeUsers
 *   GET  /healthz        ← liveness for the reverse proxy / tunnel
 *
 * Route handlers are pure async functions over FigmaDeps returning
 * {status, body} — unit-testable without sockets; the http wrapper only
 * parses/limits the body and writes the response.
 */
import { createServer, type Server } from 'node:http';
import { dayKeyFor } from '../domain/dayKey.js';
import { log } from '../logger.js';
import { FIGMA_META, type FigmaDeps } from './context.js';
import { type FigmaWebhookPayload, webhookEvent } from './normalize.js';
import { FilePresenceTracker } from './presence.js';

const MAX_BODY_BYTES = 1_000_000;

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/** One presence snapshot POSTed by the sentinel plugin. */
export interface PresenceSnapshotBody {
  passcode?: string;
  file_key?: string;
  file_name?: string;
  ts?: string;
  users?: Array<{ id?: string; name?: string; handle?: string }>;
}

const ok = (body: Record<string, unknown> = { ok: true }): RouteResult => ({ status: 200, body });
const bad = (status: number, error: string): RouteResult => ({ status, body: { error } });

/** Verify a webhook delivery and ingest its event. */
export async function handleWebhook(
  deps: FigmaDeps,
  payload: FigmaWebhookPayload,
): Promise<RouteResult> {
  const expected = deps.figma.webhook.passcode;
  if (!expected || payload.passcode !== expected) {
    log.warn('figma webhook: passcode mismatch — delivery rejected');
    return bad(403, 'passcode mismatch');
  }

  const n = webhookEvent(payload, deps.timezone);
  if (n.file) await deps.storage.upsertFigmaFile(n.file);
  if (n.member) await deps.storage.upsertFigmaMember(n.member.figmaUserId, n.member.handle);
  if (!n.event) return ok({ ok: true, ignored: payload.event_type ?? 'unknown' });

  const inserted = await deps.storage.insertFigmaEvent(n.event);
  if (inserted) await deps.storage.setMeta(FIGMA_META.lastEventAt, n.event.at);
  return ok({ ok: true, inserted });
}

/**
 * Ingest one sentinel snapshot: filter the sentinel's own user, apply the
 * miss-tolerant open/close state machine, persist interval transitions, and
 * advance the presence heartbeat. `trackers` holds per-file state and is
 * owned by the tracker runtime (so staleness resets can reach it).
 */
export async function handlePresence(
  deps: FigmaDeps,
  trackers: Map<string, FilePresenceTracker>,
  body: PresenceSnapshotBody,
): Promise<RouteResult> {
  // The sentinel shares the webhook passcode when one is configured — the
  // endpoint is only as public as the tunnel in front of it, but never open.
  const expected = deps.figma.webhook.passcode;
  if (expected && body.passcode !== expected) {
    log.warn('figma presence: passcode mismatch — snapshot rejected');
    return bad(403, 'passcode mismatch');
  }
  const fileKey = body.file_key;
  if (!fileKey || !Array.isArray(body.users)) {
    return bad(400, 'expected { file_key, users[] }');
  }

  const ts = body.ts ?? new Date().toISOString();
  const sentinel = deps.figma.presence.sentinelUserId;
  const users = body.users.filter(
    (u): u is { id: string; name?: string; handle?: string } =>
      typeof u.id === 'string' && u.id !== sentinel,
  );

  await deps.storage.upsertFigmaFile({ fileKey, name: body.file_name });
  for (const u of users) {
    const handle = u.handle ?? u.name;
    if (handle) await deps.storage.upsertFigmaMember(u.id, handle);
  }

  let tracker = trackers.get(fileKey);
  if (!tracker) {
    tracker = new FilePresenceTracker();
    trackers.set(fileKey, tracker);
  }
  const decisions = tracker.apply(users.map((u) => u.id), ts);
  const date = dayKeyFor(new Date(ts), deps.timezone);
  for (const userId of decisions.open) {
    await deps.storage.openFigmaPresence(userId, fileKey, date, ts);
  }
  for (const c of decisions.close) {
    await deps.storage.closeFigmaPresence(c.userId, fileKey, c.at);
  }
  await deps.storage.setMeta(FIGMA_META.presenceHeartbeat, ts);
  return ok({ ok: true, open: decisions.open.length, closed: decisions.close.length });
}

/** Read a JSON body with a hard size cap; null on malformed/oversized input. */
function readJson(req: import('node:http').IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

export function createFigmaServer(
  deps: FigmaDeps,
  trackers: Map<string, FilePresenceTracker>,
): Server {
  // The sentinel plugin runs in Figma's sandboxed iframe, so its POST to
  // /presence is a cross-origin request with a JSON content-type — that trips
  // a CORS preflight (OPTIONS). Without these headers the preflight fails and
  // the browser never sends the real POST ("Failed to fetch"). Figma's
  // server-to-server webhooks don't need CORS, but sending it is harmless.
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  return createServer((req, res) => {
    void (async () => {
      // Answer the CORS preflight before any routing.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }
      let result: RouteResult;
      const route = `${req.method} ${req.url?.split('?')[0]}`;
      if (route === 'GET /healthz') {
        result = ok();
      } else if (route === 'POST /figma-webhook' || route === 'POST /presence') {
        const body = await readJson(req);
        if (body === null || typeof body !== 'object') {
          result = bad(400, 'invalid JSON body');
        } else if (route === 'POST /figma-webhook') {
          result = await handleWebhook(deps, body as FigmaWebhookPayload);
        } else {
          result = await handlePresence(deps, trackers, body as PresenceSnapshotBody);
        }
      } else {
        result = bad(404, 'not found');
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(result.body));
    })().catch((err) => {
      log.error('figma server: unhandled route error', err);
      res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ error: 'internal error' }));
    });
  });
}
