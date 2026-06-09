/**
 * `report` — print a daily/weekly summary (non-interactive). `--json` emits the
 * raw Summary for piping/cron; otherwise a text table. Reads through
 * ReportService, the same read model the TUI (`view`) uses.
 */
import { ConfigError, loadConfig } from '../config/load.js';
import { todayKey } from '../domain/dayKey.js';
import { ReportService } from '../reports/ReportService.js';
import { renderDaily, renderWeekly } from '../reports/render.js';
import { createStorage } from '../storage/factory.js';

export interface ReportOptions {
  period: 'daily' | 'weekly';
  date?: string;
  json?: boolean;
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
