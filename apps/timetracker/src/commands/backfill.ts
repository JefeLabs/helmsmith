/**
 * `backfill` — replay historical channel messages through the live router so a
 * bot that started mid-day (or was added late) still captures message-driven
 * features: start-of-day (#goals), end-of-day (#summary), CI submissions, and
 * voice-chat text engagement. Poll-based signals (presence/voice samples) can't
 * be backfilled — they only exist as live 5-min ticks.
 *
 * Reuses `routeMessage` verbatim, so dedup (`markProcessed`) and the
 * first-wins / last-wins capture rules behave exactly as they do live. The one
 * thing the live path gets for free that we must enforce here: messages are
 * replayed OLDEST-FIRST, because Discord returns history newest-first and
 * start-of-day is "first post wins".
 */
import { type Client, Events, type Message } from 'discord.js';
import { createClient } from '../bot/client.js';
import type { BotDeps } from '../bot/handlers.js';
import { fromDiscordMessage } from '../bot/message.js';
import { routeMessage } from '../bot/router.js';
import { ConfigError, loadConfig } from '../config/load.js';
import { addDays, dayKeyFor, todayKey } from '../domain/dayKey.js';
import type { ISODate } from '../domain/types.js';
import { log } from '../logger.js';
import { renderDaily } from '../reports/render.js';
import { ReportService } from '../reports/ReportService.js';
import { createStorage } from '../storage/factory.js';

export interface BackfillOptions {
  /** Earliest local day to include (YYYY-MM-DD). Defaults to today. */
  since?: string;
  /** Alternative to --since: include the last N days (today inclusive). */
  days?: string;
  /** Fetch + report what would be replayed, but write nothing. */
  dryRun?: boolean;
}

/** A tracked channel and the feature its messages feed — drives the summary. */
interface TrackedChannel {
  id: string;
  role: 'goals' | 'summary' | 'ci' | 'engagement';
}

/**
 * Page a channel's history newest→oldest, keeping messages whose local day-key
 * is >= `since`. Stops as soon as a page crosses the cutoff (history is
 * monotonic in time), so we never walk the whole channel.
 */
async function fetchSince(
  channel: { messages: { fetch: (o: { limit: number; before?: string }) => Promise<Map<string, Message>> } },
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

export async function runBackfill(opts: BackfillOptions, cwd = process.cwd()): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n\nRun \`timetracker setup\` first.\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const tz = config.timezone;
  const today = todayKey(tz);
  const since: ISODate = opts.since
    ? (opts.since as ISODate)
    : opts.days
      ? addDays(today, -(Math.max(1, Number.parseInt(opts.days, 10)) - 1))
      : today;

  const channels: TrackedChannel[] = [
    { id: config.channels.goals, role: 'goals' },
    { id: config.channels.summary, role: 'summary' },
    { id: config.channels.ci, role: 'ci' },
    ...config.voiceChannelIds.map((id) => ({ id, role: 'engagement' as const })),
  ];

  const storage = await createStorage(config.storage);
  const deps: BotDeps = { storage, config };
  const client = createClient();

  const ready = new Promise<Client<true>>((resolve) => client.once(Events.ClientReady, resolve));

  try {
    log.info(`backfill — since ${since} (tz ${tz})${opts.dryRun ? ' · DRY RUN' : ''}`);
    await client.login(config.token);
    const ready_ = await ready;

    // Fetch every tracked channel, tagging each kept message with its role.
    const tagged: Array<{ msg: Message; role: TrackedChannel['role'] }> = [];
    const perRole: Record<TrackedChannel['role'], number> = {
      goals: 0,
      summary: 0,
      ci: 0,
      engagement: 0,
    };
    for (const { id, role } of channels) {
      const channel = await ready_.channels.fetch(id).catch(() => null);
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

    console.log(
      `  fetched ${tagged.length} message(s) in window — ` +
        `goals:${perRole.goals} summary:${perRole.summary} ci:${perRole.ci} engagement:${perRole.engagement}`,
    );

    if (opts.dryRun) {
      console.log('  dry run — nothing written. Re-run without --dry-run to apply.');
    } else {
      let replayed = 0;
      for (const { msg } of tagged) {
        await routeMessage(fromDiscordMessage(msg), deps);
        replayed++;
      }
      console.log(`  ✓ replayed ${replayed} message(s) through the router`);

      // Show the recovered summary for the first backfilled day.
      const reports = new ReportService(storage, config.weekStartsOn, config.trackedUserIds);
      console.log(`\n${renderDaily(await reports.daily(since), tz)}`);
    }
  } catch (err) {
    log.error('backfill failed — check DISCORD_TOKEN and the bot invite', err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
    await storage.close();
  }
}
