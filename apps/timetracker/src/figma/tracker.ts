/**
 * Figma tracker composition root — what `timetracker figma start` runs. A
 * SEPARATE process from the Discord bot (mirroring the PRD's bot/dashboard
 * split): a Discord outage never blocks Figma ingestion and vice versa. Both
 * write the same SQLite file (WAL mode, enabled in SqliteAdapter.init).
 *
 * Wires together: file seeding → webhook registration (when a public URL is
 * configured) → HTTP server (webhook + presence) → poller → staleness
 * watchdog. Everything degrades independently, per the PRD's risk table.
 */
import type { Config } from '../config/schema.js';
import { log } from '../logger.js';
import { supportsFigma } from '../storage/FigmaStorage.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { FigmaApi } from './api.js';
import { FIGMA_META, type FigmaDeps } from './context.js';
import { attachFigmaPoller } from './poller.js';
import type { FilePresenceTracker } from './presence.js';
import { createFigmaServer } from './server.js';

const WATCHDOG_INTERVAL_MS = 30_000;

export interface FigmaRuntime {
  stop(): Promise<void>;
}

export async function startFigmaTracker(
  config: Config,
  storage: StorageAdapter,
): Promise<FigmaRuntime> {
  const figma = config.figma;
  if (!figma) {
    throw new Error('figma tracking is not configured — set FIGMA_TOKEN and FIGMA_TEAM_ID');
  }
  if (!supportsFigma(storage)) {
    throw new Error(
      `figma tracking requires the sqlite storage backend (got ${config.storage.backend})`,
    );
  }
  const deps: FigmaDeps = { storage, figma, timezone: config.timezone };
  const api = new FigmaApi(figma.token);
  const stops: Array<() => void | Promise<void>> = [];

  // Seed configured file keys so the first poll has something to sweep.
  for (const fileKey of figma.fileKeys) await storage.upsertFigmaFile({ fileKey });

  // A previous run may have died with intervals open — close them at the last
  // heartbeat so a crash never inflates presence time (PRD §4.5).
  const lastHeartbeat = await storage.getMeta(FIGMA_META.presenceHeartbeat);
  const orphans = await storage.closeAllFigmaPresence(lastHeartbeat ?? new Date().toISOString());
  if (orphans > 0) log.warn(`figma: closed ${orphans} orphaned presence interval(s) from a previous run`);

  // Webhook registration — idempotent, only when we know our public URL.
  if (figma.webhook.enabled && figma.webhook.publicUrl && figma.webhook.passcode) {
    try {
      const endpoint = new URL('/figma-webhook', figma.webhook.publicUrl).toString();
      const created = await api.ensureTeamWebhooks(figma.teamId, endpoint, figma.webhook.passcode);
      log.info(`figma: webhooks ready (${created} registered this run) → ${endpoint}`);
    } catch (err) {
      // Starter-plan teams get a 4xx here — polling still covers ingestion.
      log.warn('figma: webhook registration failed — continuing in polling mode', err);
    }
  }

  // HTTP surface: needed for webhook deliveries and/or presence snapshots.
  const trackers = new Map<string, FilePresenceTracker>();
  if (figma.webhook.enabled || figma.presence.enabled) {
    const server = createFigmaServer(deps, trackers);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(figma.webhook.port, () => resolve());
    });
    log.info(
      `figma: listening on :${figma.webhook.port} (${[
        figma.webhook.enabled && 'webhooks',
        figma.presence.enabled && 'presence',
      ]
        .filter(Boolean)
        .join(' + ')})`,
    );
    stops.push(() => new Promise<void>((r) => server.close(() => r())));
  }

  // Poller: primary ingestion without webhooks; hourly backfill with them.
  const intervalMin = figma.webhook.enabled ? figma.backfillIntervalMin : figma.pollIntervalMin;
  stops.push(attachFigmaPoller(api, deps, intervalMin * 60_000));
  log.info(
    `figma: polling versions+comments every ${intervalMin} min` +
      (figma.webhook.enabled ? ' (backfill behind webhooks)' : ' (primary ingestion)'),
  );

  // Staleness watchdog: a dead sentinel must never leave intervals open.
  if (figma.presence.enabled) {
    const watchdog = setInterval(() => {
      void (async () => {
        const heartbeat = await storage.getMeta(FIGMA_META.presenceHeartbeat);
        if (!heartbeat) return;
        const ageMs = Date.now() - Date.parse(heartbeat);
        if (ageMs <= figma.presence.staleAfterSec * 1000) return;
        const closed = await storage.closeAllFigmaPresence(heartbeat);
        for (const t of trackers.values()) t.reset();
        if (closed > 0) {
          log.warn(
            `figma: sentinel stale (${Math.round(ageMs / 1000)}s) — force-closed ${closed} interval(s)`,
          );
        }
      })().catch((err) => log.error('figma: staleness watchdog error', err));
    }, WATCHDOG_INTERVAL_MS);
    stops.push(() => clearInterval(watchdog));
  }

  return {
    async stop() {
      for (const stop of stops.reverse()) await stop();
    },
  };
}
