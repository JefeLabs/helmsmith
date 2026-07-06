/**
 * Render summaries as Discord messages. Reuses the plain-text tables inside a
 * code block (monospace preserves column alignment) — used by both the slash
 * commands and the scheduled push (M7). Same ReportService data as the CLI/TUI.
 */
import type { ISODate } from '../domain/types.js';
import type { ReportService } from './ReportService.js';
import { renderDaily, renderWeekly } from './render.js';

const DISCORD_MAX = 2000;

/** Wrap body in a code block, prefixed with a header; clamp to Discord's limit. */
function codeBlock(header: string, body: string): string {
  const wrapped = `${header}\n\`\`\`\n${body}\n\`\`\``;
  if (wrapped.length <= DISCORD_MAX) return wrapped;
  const room = DISCORD_MAX - header.length - 16;
  return `${header}\n\`\`\`\n${body.slice(0, room)}\n…(truncated)\n\`\`\``;
}

export async function dailyMessage(
  reports: ReportService,
  date: ISODate,
  tz: string,
): Promise<string> {
  return codeBlock('📊 **Daily summary**', renderDaily(await reports.daily(date), tz));
}

export async function weeklyMessage(
  reports: ReportService,
  anchor: ISODate,
  tz: string,
): Promise<string> {
  return codeBlock('🗓️ **Weekly summary**', renderWeekly(await reports.weekly(anchor), tz));
}
