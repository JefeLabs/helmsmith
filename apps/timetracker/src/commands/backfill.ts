/**
 * `backfill` — replay historical channel messages through the live router so a
 * bot that started mid-day (or was added late) still captures message-driven
 * features: start-of-day (#goals), end-of-day (#summary), CI submissions, and
 * voice-chat text engagement. Poll-based signals (presence/voice samples) can't
 * be backfilled — they only exist as live 5-min ticks.
 *
 * The fetch/replay engine lives in `../bot/replay.ts` and is shared with
 * `start`'s automatic catch-up; this file is only the CLI shell (its own
 * client + login, window flags, dry-run reporting).
 */
import { type Client, Events } from 'discord.js';
import { createClient } from '../bot/client.js';
import type { BotDeps } from '../bot/handlers.js';
import { replayHistory } from '../bot/replay.js';
import { ConfigError, loadConfig } from '../config/load.js';
import { addDays, todayKey } from '../domain/dayKey.js';
import type { ISODate } from '../domain/types.js';
import { log } from '../logger.js';
import { renderDaily } from '../reports/render.js';
import { reportServiceFor } from '../reports/ReportService.js';
import { createStorage } from '../storage/factory.js';

export interface BackfillOptions {
  /** Earliest local day to include (YYYY-MM-DD). Defaults to today. */
  since?: string;
  /** Alternative to --since: include the last N days (today inclusive). */
  days?: string;
  /** Fetch + report what would be replayed, but write nothing. */
  dryRun?: boolean;
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

  const storage = await createStorage(config.storage);
  const deps: BotDeps = { storage, config };
  const client = createClient();

  const ready = new Promise<Client<true>>((resolve) => client.once(Events.ClientReady, resolve));

  try {
    log.info(`backfill — since ${since} (tz ${tz})${opts.dryRun ? ' · DRY RUN' : ''}`);
    await client.login(config.token);
    const ready_ = await ready;

    const { fetched, replayed, perRole } = await replayHistory(ready_, deps, since, {
      dryRun: opts.dryRun,
    });
    console.log(
      `  fetched ${fetched} message(s) in window — ` +
        `goals:${perRole.goals} summary:${perRole.summary} ci:${perRole.ci} engagement:${perRole.engagement}`,
    );

    if (opts.dryRun) {
      console.log('  dry run — nothing written. Re-run without --dry-run to apply.');
    } else {
      console.log(`  ✓ replayed ${replayed} message(s) through the router`);

      // Show the recovered summary for the first backfilled day.
      const reports = reportServiceFor(storage, config);
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
