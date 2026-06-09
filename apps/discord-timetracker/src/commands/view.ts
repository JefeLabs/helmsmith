/**
 * `view` — open the interactive daily/weekly summary TUI. Same read model
 * (ReportService) as `report`, rendered with tui-view-components.
 */
import { ConfigError, loadConfig } from '../config/load.js';
import { todayKey } from '../domain/dayKey.js';
import { ReportService } from '../reports/ReportService.js';
import { createStorage } from '../storage/factory.js';

export interface ViewOptions {
  period: 'daily' | 'weekly';
  date?: string;
}

export async function runView(opts: ViewOptions, cwd = process.cwd()): Promise<void> {
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

  // Lazy import: the TUI pulls in @opentui (heavy, and Bun-only assets), so it
  // must not load for other commands or the dev (tsx) runtime — only here.
  const { runViewer } = await import('../tui/runViewer.js');

  const storage = await createStorage(config.storage);
  try {
    const reports = new ReportService(storage, config.weekStartsOn);
    await runViewer({
      reports,
      timezone: config.timezone,
      period: opts.period === 'weekly' ? 'weekly' : 'daily',
      date: opts.date ?? todayKey(config.timezone),
    });
  } finally {
    await storage.close();
  }
}
