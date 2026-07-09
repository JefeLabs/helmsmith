/**
 * Shared history-replay engine: fetch every tracked channel's messages since a
 * local day and push them through the live router, oldest-first. Used by the
 * `backfill` CLI verb and by `start`'s automatic catch-up. `markProcessed`
 * dedup makes replay idempotent, so overlapping a live gateway session (or
 * re-running) is safe.
 *
 * Messages are replayed OLDEST-FIRST because Discord returns history
 * newest-first and start-of-day is "first post wins".
 */
import type { Client, Message } from 'discord.js';
import { addDays, dayKeyFor } from '../domain/dayKey.js';
import type { ISODate } from '../domain/types.js';
import type { BotDeps } from './handlers.js';
import { fromDiscordMessage } from './message.js';
import { routeMessage } from './router.js';

/** A tracked channel and the feature its messages feed — drives the summary. */
export type ChannelRole = 'goals' | 'summary' | 'ci' | 'engagement';

export interface ReplayResult {
  /** Messages found in the window across all tracked channels. */
  fetched: number;
  /** Messages pushed through the router (0 on a dry run). */
  replayed: number;
  perRole: Record<ChannelRole, number>;
}

/** The channels the replay sweeps, tagged with the feature each one feeds. */
export function trackedChannels(
  config: BotDeps['config'],
): Array<{ id: string; role: ChannelRole }> {
  return [
    { id: config.channels.goals, role: 'goals' },
    { id: config.channels.summary, role: 'summary' },
    { id: config.channels.ci, role: 'ci' },
    ...config.voiceChannelIds.map((id) => ({ id, role: 'engagement' as const })),
  ];
}

/**
 * Decide how far back `start`'s automatic catch-up should reach, or return
 * null to skip it entirely.
 *
 * @param lastSeenAt ISO instant of the previous run's poller heartbeat —
 *   "the bot was alive until here" — or null if no heartbeat was ever written
 *   (first run, or an upgrade from a version without heartbeats).
 * @param today   current local day key.
 * @param maxDays hard cap on the window, in days (today inclusive) — bounds
 *   Discord history paging on very long gaps.
 * @param tz      configured IANA timezone (day boundaries).
 *
 * Policy: start at the LOCAL day the bot went dark — a gap that spans
 * midnight leaves that day's evening #summary posts unrecovered, so `today`
 * alone is not enough — clamped to at most `maxDays` back. Replay is
 * idempotent, so over-reaching costs only API paging, never double-counting.
 * With no heartbeat there is no known gap: replay today only rather than
 * silently ingesting pre-tracking history into reports.
 */
export function resolveBackfillSince(
  lastSeenAt: string | null,
  today: ISODate,
  maxDays: number,
  tz: string,
): ISODate | null {
  if (!lastSeenAt) return today;
  const gapStart = dayKeyFor(new Date(lastSeenAt), tz);
  const floor = addDays(today, -(maxDays - 1));
  const since = gapStart < floor ? floor : gapStart;
  return since > today ? today : since; // clock-skew guard: never a future day
}

/**
 * Page a channel's history newest→oldest, keeping messages whose local day-key
 * is >= `since`. Stops as soon as a page crosses the cutoff (history is
 * monotonic in time), so we never walk the whole channel.
 */
async function fetchSince(
  channel: {
    messages: {
      fetch: (o: { limit: number; before?: string }) => Promise<Map<string, Message>>;
    };
  },
  since: ISODate,
  tz: string,
): Promise<Message[]> {
  const kept: Message[] = [];
  let before: string | undefined;
  for (;;) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    let crossedCutoff = false;
    for (const msg of batch.values()) {
      if (dayKeyFor(msg.createdAt, tz) < since) {
        crossedCutoff = true;
        continue;
      }
      kept.push(msg);
    }
    before = [...batch.values()].at(-1)?.id; // oldest id in this page
    if (crossedCutoff || batch.size < 100 || !before) break;
  }
  return kept;
}

/** Fetch every tracked channel since `since` and replay through the router. */
export async function replayHistory(
  client: Client<true>,
  deps: BotDeps,
  since: ISODate,
  opts: { dryRun?: boolean } = {},
): Promise<ReplayResult> {
  const tz = deps.config.timezone;
  const tagged: Array<{ msg: Message; role: ChannelRole }> = [];
  const perRole: Record<ChannelRole, number> = { goals: 0, summary: 0, ci: 0, engagement: 0 };
  for (const { id, role } of trackedChannels(deps.config)) {
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      console.error(`  ! skipping ${role} channel ${id} — not a readable text channel`);
      continue;
    }
    const msgs = await fetchSince(channel, since, tz).catch((err) => {
      console.error(`  ! failed to fetch ${role} channel ${id}:`, err.message);
      return [] as Message[];
    });
    perRole[role] += msgs.length;
    for (const msg of msgs) tagged.push({ msg, role });
  }

  // Oldest-first: start-of-day is first-wins, end-of-day is last-wins.
  tagged.sort((a, b) => a.msg.createdTimestamp - b.msg.createdTimestamp);

  let replayed = 0;
  if (!opts.dryRun) {
    for (const { msg } of tagged) {
      await routeMessage(fromDiscordMessage(msg), deps);
      replayed++;
    }
  }
  return { fetched: tagged.length, replayed, perRole };
}
