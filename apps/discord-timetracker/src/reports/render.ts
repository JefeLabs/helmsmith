/**
 * Plain-text rendering for the non-interactive `report` command. (The TUI in M6
 * renders the same Summary objects with tui-view-components instead.)
 *
 * Note: rows show Discord user IDs — the bot doesn't yet store display names
 * (would require a guild lookup). Resolving names is a later enhancement.
 */
import type { DailySummary, WeeklySummary } from './types.js';

/** First whitespace token of a name: "Yelisson Ortiz - Skoolscout" → "Yelisson". */
export function firstName(name: string): string {
  return name.split(/\s+/)[0] || name;
}

/** Minutes → "2h 30m" / "45m" / "—". */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** ISO timestamp → "HH:MM" in the configured timezone, or "—". */
export function formatTime(iso: string | undefined, tz: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  return [line(headers), sep, ...rows.map(line)].join('\n');
}

export function renderDaily(s: DailySummary, tz: string): string {
  if (s.users.length === 0) return `Daily summary — ${s.date}\n(no activity recorded)`;
  const rows = s.users.map((u) => [
    firstName(u.displayName ?? u.userId),
    formatDuration(u.activeMinutes),
    formatDuration(u.idleMinutes),
    formatDuration(u.spanMinutes),
    formatDuration(u.voiceMinutes),
    String(u.ciSubmissions),
    String(u.engagementMessages),
    formatTime(u.startedAt, tz),
    formatTime(u.endedAt, tz),
  ]);
  return `Daily summary — ${s.date} (${tz})\n\n${table(
    ['User', 'Active', 'Idle', 'Span', 'Voice', 'CI', 'Msgs', 'Start', 'End'],
    rows,
  )}`;
}

export function renderWeekly(s: WeeklySummary, _tz: string): string {
  if (s.users.length === 0) return `Weekly summary — ${s.from} → ${s.to}\n(no activity recorded)`;
  const rows = s.users.map((u) => [
    firstName(u.displayName ?? u.userId),
    formatDuration(u.onlineMinutes),
    formatDuration(u.voiceMinutes),
    String(u.ciSubmissions),
    String(u.engagementMessages),
    `${u.daysActive}/7`,
  ]);
  return `Weekly summary — ${s.from} → ${s.to}\n\n${table(
    ['User', 'Online', 'Voice', 'CI', 'Msgs', 'Days'],
    rows,
  )}`;
}
