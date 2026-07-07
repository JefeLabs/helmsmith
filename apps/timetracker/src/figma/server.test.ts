import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FigmaSchema } from '../config/schema.js';
import { SqliteAdapter } from '../storage/sqlite/SqliteAdapter.js';
import { FIGMA_META, type FigmaDeps } from './context.js';
import { FilePresenceTracker } from './presence.js';
import { createFigmaServer, handlePresence, handleWebhook } from './server.js';

const TZ = 'America/New_York';

function makeDeps(storage: SqliteAdapter): FigmaDeps {
  return {
    storage,
    timezone: TZ,
    figma: FigmaSchema.parse({
      token: 'figd_test',
      teamId: '99',
      webhook: { enabled: true, passcode: 'pass' },
      presence: { enabled: true, sentinelUserId: 'sentinel' },
    }),
  };
}

const versionDelivery = (over: Record<string, unknown> = {}) => ({
  event_type: 'FILE_VERSION_UPDATE',
  passcode: 'pass',
  file_key: 'fileA',
  file_name: 'design-system',
  timestamp: '2026-07-06T14:00:00Z',
  triggered_by: { id: 'u1', handle: 'ana' },
  version_id: 'v42',
  ...over,
});

describe('handleWebhook', () => {
  let storage: SqliteAdapter;
  let deps: FigmaDeps;
  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    deps = makeDeps(storage);
  });

  it('rejects a delivery with a wrong or missing passcode', async () => {
    expect((await handleWebhook(deps, versionDelivery({ passcode: 'nope' }))).status).toBe(403);
    expect((await handleWebhook(deps, versionDelivery({ passcode: undefined }))).status).toBe(403);
    expect(await storage.listFigmaEventsRange('2026-07-06', '2026-07-06')).toHaveLength(0);
  });

  it('ingests an event and upserts the file, member, and last-event meta', async () => {
    const r = await handleWebhook(deps, versionDelivery());
    expect(r).toEqual({ status: 200, body: { ok: true, inserted: true } });

    const [e] = await storage.listFigmaEventsRange('2026-07-06', '2026-07-06');
    expect(e).toMatchObject({ eventType: 'version', externalId: 'v42', source: 'webhook' });
    expect((await storage.listFigmaFiles())[0]).toMatchObject({ name: 'design-system' });
    expect((await storage.listFigmaMembers())[0]).toMatchObject({ handle: 'ana' });
    expect(await storage.getMeta(FIGMA_META.lastEventAt)).toBe('2026-07-06T14:00:00Z');
  });

  it('acknowledges a redelivery without double-counting', async () => {
    await handleWebhook(deps, versionDelivery());
    const r = await handleWebhook(deps, versionDelivery());
    expect(r.body).toEqual({ ok: true, inserted: false });
    expect(await storage.listFigmaEventsRange('2026-07-06', '2026-07-06')).toHaveLength(1);
  });

  it('acknowledges PING without storing anything', async () => {
    const r = await handleWebhook(deps, { event_type: 'PING', passcode: 'pass' });
    expect(r.status).toBe(200);
    expect(await storage.listFigmaEventsRange('2020-01-01', '2030-01-01')).toHaveLength(0);
  });
});

describe('handlePresence', () => {
  let storage: SqliteAdapter;
  let deps: FigmaDeps;
  let trackers: Map<string, FilePresenceTracker>;
  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    deps = makeDeps(storage);
    trackers = new Map();
  });

  const snapshot = (users: Array<{ id: string; name?: string }>, ts: string) => ({
    passcode: 'pass',
    file_key: 'fileA',
    file_name: 'design-system',
    ts,
    users,
  });

  it('rejects a snapshot with a wrong passcode when one is configured', async () => {
    const r = await handlePresence(deps, trackers, snapshot([], '2026-07-06T14:00:00Z'));
    expect(r.status).toBe(200);
    const bad = await handlePresence(deps, trackers, {
      ...snapshot([], '2026-07-06T14:00:00Z'),
      passcode: 'nope',
    });
    expect(bad.status).toBe(403);
  });

  it('opens intervals for present users, filtering the sentinel itself', async () => {
    const r = await handlePresence(
      deps,
      trackers,
      snapshot(
        [{ id: 'u1', name: 'ana' }, { id: 'sentinel', name: 'tracker-bot' }],
        '2026-07-06T14:00:00Z',
      ),
    );
    expect(r.body).toMatchObject({ open: 1 });
    const open = await storage.listOpenFigmaPresence();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ figmaUserId: 'u1', fileKey: 'fileA' });
    expect(await storage.getMeta(FIGMA_META.presenceHeartbeat)).toBe('2026-07-06T14:00:00Z');
  });

  it('closes at last-seen ts after two consecutive missing snapshots', async () => {
    await handlePresence(deps, trackers, snapshot([{ id: 'u1' }], '2026-07-06T14:00:00Z'));
    await handlePresence(deps, trackers, snapshot([{ id: 'u1' }], '2026-07-06T14:01:00Z'));
    await handlePresence(deps, trackers, snapshot([], '2026-07-06T14:02:00Z')); // miss 1
    await handlePresence(deps, trackers, snapshot([], '2026-07-06T14:03:00Z')); // miss 2 → close
    expect(await storage.listOpenFigmaPresence()).toHaveLength(0);
    const [iv] = await storage.listFigmaPresenceRange('2026-07-06', '2026-07-06');
    expect(iv.startAt).toBe('2026-07-06T14:00:00Z');
    expect(iv.endAt).toBe('2026-07-06T14:01:00Z'); // last seen, not miss time
  });

  it('rejects a malformed body', async () => {
    const r = await handlePresence(deps, trackers, { passcode: 'pass' });
    expect(r.status).toBe(400);
  });
});

describe('createFigmaServer — CORS (Figma plugin runs in a sandboxed iframe)', () => {
  let storage: SqliteAdapter;
  let server: ReturnType<typeof createFigmaServer>;
  let base: string;

  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    server = createFigmaServer(makeDeps(storage), new Map<string, FilePresenceTracker>());
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await storage.close();
  });

  it('answers the preflight OPTIONS so the plugin POST is not blocked', async () => {
    const res = await fetch(`${base}/presence`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'null',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toMatch(/content-type/i);
  });

  it('sends the CORS header on the actual presence POST', async () => {
    const res = await fetch(`${base}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'null' },
      body: JSON.stringify({
        passcode: 'pass',
        file_key: 'F',
        file_name: 'x',
        ts: '2026-07-07T14:00:00.000Z',
        users: [{ id: 'u1', name: 'ana' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({ ok: true, open: 1 });
  });
});
