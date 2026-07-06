/**
 * Message-driven feature handlers (M3). Each is a pure async function over an
 * IncomingMessage + BotDeps, so they're testable with an in-memory adapter.
 * The router (router.ts) decides which handler a message reaches.
 */
import type { Config } from '../config/schema.js';
import { dayKeyFor } from '../domain/dayKey.js';
import { isTracked } from '../domain/tracked.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { IncomingMessage } from './message.js';

export interface BotDeps {
  storage: StorageAdapter;
  config: Config;
}

const dayOf = (m: IncomingMessage, cfg: Config) => dayKeyFor(m.createdAt, cfg.timezone);

/**
 * Feature 2 — start of day (#goals-for-the-day). First post of the day wins by
 * default (later posts are treated as goal edits and don't move the start).
 */
export async function handleStartOfDay(
  m: IncomingMessage,
  { storage, config }: BotDeps,
): Promise<void> {
  await storage.setUserName(m.authorId, m.authorName);
  const date = dayOf(m, config);
  if (config.capture.startOfDayFirstWins) {
    const existing = await storage.getDay(m.authorId, date);
    if (existing?.startOfDay) return;
  }
  await storage.setStartOfDay(m.authorId, date, {
    at: m.createdAt.toISOString(),
    messageId: m.id,
    goals: m.content,
  });
}

/**
 * Feature 4 — end of day (#summary-of-the-day). Last post of the day wins by
 * default (the final summary is the real end-of-day marker).
 */
export async function handleEndOfDay(
  m: IncomingMessage,
  { storage, config }: BotDeps,
): Promise<void> {
  await storage.setUserName(m.authorId, m.authorName);
  const date = dayOf(m, config);
  if (!config.capture.endOfDayLastWins) {
    const existing = await storage.getDay(m.authorId, date);
    if (existing?.endOfDay) return;
  }
  await storage.setEndOfDay(m.authorId, date, {
    at: m.createdAt.toISOString(),
    messageId: m.id,
    summary: m.content,
  });
}

/** Feature 6a — text engagement: a message in a tracked voice channel's chat. */
export async function handleEngagementText(
  m: IncomingMessage,
  { storage, config }: BotDeps,
): Promise<void> {
  await storage.setUserName(m.authorId, m.authorName);
  await storage.incrementEngagement(m.authorId, dayOf(m, config));
}

/** Matches every `PR Actor: <login>` line in a GitHub Monitor message. */
export const PR_ACTOR_RE = /^PR Actor:\s*(.+?)\s*$/gm;

/**
 * Feature 5 — CI submissions (#ci-cd-notifications). The poster is the
 * "GitHub Monitor" bot; one message may carry several run blocks. Parse EVERY
 * `PR Actor:` line, resolve github→discord, and increment per mapped human.
 * Non-human/unlinked actors (e.g. "Github System") resolve to null → skipped.
 *
 * Returns how many submissions were attributed (handy for logging/tests).
 */
export async function handleCiSubmission(
  m: IncomingMessage,
  { storage, config }: BotDeps,
): Promise<number> {
  const date = dayOf(m, config);
  const actors = [...m.content.matchAll(PR_ACTOR_RE)].map((match) => match[1].trim());
  let counted = 0;
  for (const actor of actors) {
    const userId = await storage.resolveIdentity('github', actor);
    if (!userId) continue;
    if (!isTracked(userId, config.trackedUserIds)) continue; // only tracked humans
    await storage.incrementCi(userId, date);
    counted++;
  }
  return counted;
}
