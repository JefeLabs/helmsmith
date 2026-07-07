/**
 * Version/comment polling (PRD §4.2). In polling-only mode this IS ingestion
 * (10-min default); in webhook mode it still runs hourly as backfill so a
 * webhook outage costs latency, not data. The event dedupe key makes re-seeing
 * the same versions/comments free, so the poller needs no cursor bookkeeping
 * to stay correct — `figma:last_poll_at` in meta is diagnostics, not state.
 */
import { log } from '../logger.js';
import type { FigmaComment, FigmaVersion } from './api.js';
import { FIGMA_META, type FigmaDeps } from './context.js';
import { commentEvent, versionEvent } from './normalize.js';

/** The two API calls the poller needs — lets tests stub the client. */
export interface FigmaPollApi {
  getFileVersions(fileKey: string): Promise<FigmaVersion[]>;
  getFileComments(fileKey: string): Promise<FigmaComment[]>;
}

/**
 * One sweep over all tracked files. A file that throws (rate limit, deleted,
 * revoked) is logged and skipped — the others still ingest, and the next
 * sweep retries.
 */
export async function runFigmaPollOnce(
  api: FigmaPollApi,
  deps: FigmaDeps,
): Promise<{ files: number; inserted: number }> {
  const files = await deps.storage.listFigmaFiles({ trackedOnly: true });
  let inserted = 0;
  let lastEventAt: string | undefined;

  for (const file of files) {
    try {
      const [versions, comments] = await Promise.all([
        api.getFileVersions(file.fileKey),
        api.getFileComments(file.fileKey),
      ]);
      for (const v of versions) {
        if (v.user) await deps.storage.upsertFigmaMember(v.user.id, v.user.handle);
        const e = versionEvent(file.fileKey, v, deps.timezone);
        if (await deps.storage.insertFigmaEvent(e)) {
          inserted++;
          if (!lastEventAt || e.at > lastEventAt) lastEventAt = e.at;
        }
      }
      for (const c of comments) {
        if (c.user) await deps.storage.upsertFigmaMember(c.user.id, c.user.handle);
        const e = commentEvent(file.fileKey, c, deps.timezone);
        if (await deps.storage.insertFigmaEvent(e)) {
          inserted++;
          if (!lastEventAt || e.at > lastEventAt) lastEventAt = e.at;
        }
      }
    } catch (err) {
      log.warn(`figma poll: ${file.fileKey} failed — skipping this sweep`, err);
    }
  }

  await deps.storage.setMeta(FIGMA_META.lastPollAt, new Date().toISOString());
  if (lastEventAt) {
    const prev = await deps.storage.getMeta(FIGMA_META.lastEventAt);
    if (!prev || lastEventAt > prev) {
      await deps.storage.setMeta(FIGMA_META.lastEventAt, lastEventAt);
    }
  }
  return { files: files.length, inserted };
}

/** Sweep now (startup catch-up), then on an interval. Returns a stop fn. */
export function attachFigmaPoller(
  api: FigmaPollApi,
  deps: FigmaDeps,
  intervalMs: number,
): () => void {
  const sweep = () =>
    runFigmaPollOnce(api, deps)
      .then(({ files, inserted }) => {
        if (inserted > 0) log.info(`figma poll: ${inserted} new events across ${files} files`);
      })
      .catch((err) => log.error('figma poll sweep failed', err));

  void sweep();
  const timer = setInterval(() => void sweep(), intervalMs);
  return () => clearInterval(timer);
}
