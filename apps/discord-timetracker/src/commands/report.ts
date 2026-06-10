/**
 * `report` — print a daily/weekly summary (non-interactive). `--json` emits the
 * raw Summary for piping/cron; `--post` sends it to the Discord report channel
 * (the same message the 07:00 scheduler and `/report` produce); otherwise a
 * text table. Reads through ReportService, the same read model `view` uses.
 */
import { Events } from 'discord.js';
import { createClient } from '../bot/client.js';
import { ConfigError, loadConfig } from '../config/load.js';
import type { Config } from '../config/schema.js';
import { todayKey } from '../domain/dayKey.js';
import { dailyMessage, weeklyMessage } from '../reports/discord.js';
import { ReportService } from '../reports/ReportService.js';
import { renderDaily, renderWeekly } from '../reports/render.js';
import { createStorage } from '../storage/factory.js';

export interface ReportOptions {
  period: 'daily' | 'weekly';
  date?: string;
  json?: boolean;
  /** Post the summary to the Discord report channel instead of printing. */
  post?: boolean;
}

/** Connect, send the rendered summary to the report channel, then disconnect. */
async function postToReportChannel(
  config: Config,
  reports: ReportService,
  period: 'daily' | 'weekly',
  date: string,
): Promise<void> {
  const body =
    period === 'weekly'
      ? await weeklyMessage(reports, date, config.timezone)
      : await dailyMessage(reports, date, config.timezone);
  const client = createClient();
  try {
    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, (ready) => {
        ready.channels
          .fetch(config.reportChannelId)
          .then(async (channel) => {
            if (!channel?.isTextBased() || !('send' in channel)) {
              throw new Error('report channel is not a sendable text channel');
            }
            await channel.send(body);
            const name = ('name' in channel && channel.name) || config.reportChannelId;
            console.log(`✓ posted ${period} summary to #${name}`);
          })
          .then(resolve, reject);
      });
      client.login(config.token).catch(reject);
    });
  } finally {
    await client.destroy();
  }
}

export async function runReport(opts: ReportOptions, cwd = process.cwd()): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n\nRun \`discord-timetracker setup\` first.\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  const period = opts.period === 'weekly' ? 'weekly' : 'daily';
  const date = opts.date ?? todayKey(config.timezone);
  const storage = await createStorage(config.storage);
  try {
    const reports = new ReportService(storage, config.weekStartsOn);
    if (opts.post) {
      await postToReportChannel(config, reports, period, date);
      return;
    }
    const summary = period === 'weekly' ? await reports.weekly(date) : await reports.daily(date);
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        summary.period === 'weekly'
          ? renderWeekly(summary, config.timezone)
          : renderDaily(summary, config.timezone),
      );
    }
  } finally {
    await storage.close();
  }
}
