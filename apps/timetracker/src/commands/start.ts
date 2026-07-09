/**
 * `start` — load config, open storage, connect to the gateway, begin tracking.
 * Message-driven features (start/end of day, CI, text engagement) are live in
 * M3; presence + voice sampling join in M4.
 */
import { Events } from 'discord.js';
import { createClient, wireBot } from '../bot/client.js';
import { attachPoller } from '../bot/poller.js';
import { replayHistory, resolveBackfillSince } from '../bot/replay.js';
import { attachScheduler } from '../bot/scheduler.js';
import { attachSlashCommands } from '../bot/slash.js';
import { ConfigError, loadConfig } from '../config/load.js';
import { LAST_SEEN_META_KEY } from '../domain/constants.js';
import { todayKey } from '../domain/dayKey.js';
import { log } from '../logger.js';
import { reportServiceFor } from '../reports/ReportService.js';
import { createStorage } from '../storage/factory.js';

export async function runStart(cwd = process.cwd()): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n\nRun \`timetracker setup\` to create a config.\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const storage = await createStorage(config.storage);
  const deps = { storage, config };
  const reports = reportServiceFor(storage, config);
  const client = wireBot(createClient(), deps);
  const stopPoller = attachPoller(client, deps);
  const stopScheduler = attachScheduler(client, deps, reports);
  attachSlashCommands(client, deps, reports);

  // Catch-up backfill: recover message-driven signals (start/end of day, CI,
  // engagement) missed while the bot was down. The previous run's heartbeat is
  // read BEFORE this run can write its own — a fresh heartbeat would make the
  // gap invisible. Failures warn; a broken backfill must never keep the bot
  // from going live (replay is idempotent, so the live session may overlap it).
  if (config.startupBackfill.enabled) {
    const lastSeenAt = await storage.getMeta(LAST_SEEN_META_KEY);
    client.once(Events.ClientReady, (ready) => {
      void (async () => {
        const since = resolveBackfillSince(
          lastSeenAt,
          todayKey(config.timezone),
          config.startupBackfill.maxDays,
          config.timezone,
        );
        if (!since) return;
        const { fetched, replayed } = await replayHistory(ready, deps, since);
        console.log(
          `  ✓ catch-up backfill since ${since} — replayed ${replayed}/${fetched} fetched message(s)`,
        );
      })().catch((err) => log.warn('catch-up backfill failed — continuing live', err));
    });
  }

  // Graceful shutdown: stop timers, disconnect, flush/close storage on Ctrl-C.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} — shutting down…`);
    stopPoller();
    stopScheduler();
    await client.destroy();
    await storage.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  log.info(`starting — storage: ${config.storage.backend} · timezone: ${config.timezone}`);
  try {
    await client.login(config.token);
  } catch (err) {
    log.error('failed to connect to Discord — check DISCORD_TOKEN and the bot invite', err);
    stopPoller();
    stopScheduler();
    await storage.close();
    process.exitCode = 1;
  }
}
