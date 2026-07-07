/**
 * Plain-text rendering for the non-interactive `report` command. (The TUI in M6
 * renders the same Summary objects with tui-view-components instead.)
 *
 * Note: rows show Discord user IDs — the bot doesn't yet store display names
 * (would require a guild lookup). Resolving names is a later enhancement.
 */
import type { DailySummary, WeeklySummary } from './types.js';
import { WEEKDAYS, weekGrid } from './weekGrid.js';

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

// Intl.DateTimeFormat construction is costly and formatTime runs ~2× per row across
// the daily grid; cache one formatter per timezone (keyed by string, bounded by the
// handful of tz values in play — a plain Map is fine, no WeakMap needed).
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = timeFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    timeFormatters.set(tz, fmt);
  }
  return fmt;
}

/** ISO timestamp → "HH:MM" in the configured timezone, or "—". */
export function formatTime(iso: string | undefined, tz: string): string {
  if (!iso) return '—';
  return timeFormatter(tz).format(new Date(iso));
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
  const daily = `Daily summary — ${s.date} (${tz})\n\n${table(
    ['User', 'Active', 'Idle', 'Span', 'Voice', 'CI', 'Msgs', 'Start', 'End'],
    rows,
  )}`;
  const figma = renderFigmaCorrelation(s);
  return figma ? `${daily}\n\n${figma}` : daily;
}

/**
 * Correlation rows (PRD §5.4): Discord voice vs Figma output per member.
 * Burst time is an estimate (~/est.); sentinel in-file time is measured and
 * rendered without the marker — the distinction is a hard display rule.
 */
function renderFigmaCorrelation(s: DailySummary): string | null {
  const withFigma = s.users.filter((u) => u.figma);
  if (withFigma.length === 0) return null;
  const lines = withFigma.map((u) => {
    const f = u.figma!;
    const parts = [
      `voice ${formatDuration(u.voiceMinutes)}`,
      `figma ${f.eventCount} events, ~${formatDuration(f.estBurstMinutes)} est.`,
    ];
    if (f.presenceMinutes > 0) parts.push(`in-file ${formatDuration(f.presenceMinutes)}`);
    if (f.topFiles.length > 0) parts.push(f.topFiles.join(', '));
    return `  ${firstName(u.displayName ?? u.userId).padEnd(12)} ${parts.join('  |  ')}`;
  });
  return `Figma correlation (burst times are estimates)\n${lines.join('\n')}`;
}

/**
 * Per-user workweek grid: one `active|idle` cell per weekday (Mon–Fri), the week's
 * active total, and the average active time per day actually worked. Rows are
 * ordered by weekly active time. Weekend activity is tracked but not shown here.
 * Folds each row through the shared weekGrid so the TUI + Discord summary match.
 */
export function renderWeekly(s: WeeklySummary, _tz: string): string {
  if (s.users.length === 0) return `Weekly summary — ${s.from} → ${s.to}\n(no activity recorded)`;
  const rows = s.users.map((u) => {
    const g = weekGrid(u);
    const avg = g.avgActiveMinutes > 0 ? formatDuration(g.avgActiveMinutes) : '—';
    return [
      firstName(u.displayName ?? u.userId),
      ...g.cells,
      formatDuration(g.wkActiveMinutes),
      avg,
    ];
  });
  return `Weekly summary (workweek · active|idle) — ${s.from} → ${s.to}\n\n${table(
    ['User', ...WEEKDAYS, 'WK Active', 'Avg/day'],
    rows,
  )}`;
}
