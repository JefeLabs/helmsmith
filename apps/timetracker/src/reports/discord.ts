/**
 * Render summaries as Discord messages. Reuses the plain-text tables inside a
 * code block (monospace preserves column alignment) — used by both the slash
 * commands and the scheduled push (M7). Same ReportService data as the CLI/TUI.
 */
import type { ISODate } from '../domain/types.js';
import type { ReportService } from './ReportService.js';
import { renderDaily, renderFigmaDaily, renderWeekly } from './render.js';

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

/**
 * The Figma activity report as one or more code-block messages. Figma content
 * (member table + file heat + event log) can exceed Discord's 2000-char cap,
 * so this CHUNKS by line rather than truncating — every event survives. Used
 * by the scheduled push and `figma report --post`. `includePresenceNow` is off
 * for a scheduled recap of a past day (presence is a live concept).
 */
export async function figmaMessages(
  reports: ReportService,
  date: ISODate,
  tz: string,
  opts: { includePresenceNow?: boolean } = {},
): Promise<string[]> {
  const text = renderFigmaDaily(await reports.figmaDaily(date), tz, opts);
  const header = '🎨 **Figma activity**';
  const room = DISCORD_MAX - 8; // fence markers ```\n … \n```
  const chunks: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf.length + line.length + 1 > room) {
      chunks.push(`\`\`\`\n${buf}\n\`\`\``);
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) chunks.push(`\`\`\`\n${buf}\n\`\`\``);
  if (chunks.length > 0) chunks[0] = `${header}\n${chunks[0]}`;
  return chunks;
}
