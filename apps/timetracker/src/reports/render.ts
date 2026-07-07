/**
 * Plain-text rendering for the non-interactive `report` command. (The TUI in M6
 * renders the same Summary objects with tui-view-components instead.)
 *
 * Note: rows show Discord user IDs — the bot doesn't yet store display names
 * (would require a guild lookup). Resolving names is a later enhancement.
 */
import type { DailySummary, FigmaDailySummary, WeeklySummary } from './types.js';
import { WEEKDAYS, weekGrid } from './weekGrid.js';

const FIGMA_EVENT_LABEL: Record<string, string> = {
  file_update: 'file updated',
  version: 'version saved',
  comment: 'comment',
  library_publish: 'library publish',
  file_delete: 'file deleted',
};

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

/**
 * Figma activity report (the `figma report` CLI + Discord post). Renders the
 * same `figmaDaily` feed the TUI `f` panel shows. The estimate/measured split
 * is a hard display rule: burst time carries the `~`/`est.` marker; sentinel
 * in-file time is measured and shown plain.
 */
export function renderFigmaDaily(
  f: FigmaDailySummary,
  tz: string,
  opts: { includePresenceNow?: boolean } = {},
): string {
  if (!f.available) return `Figma activity — ${f.date}\n(figma tracking not available on this storage backend)`;

  const out: string[] = [`Figma activity — ${f.date} (${tz})`];

  // Presence now (measured) — ⚠ STALE when the sentinel heartbeat lapsed.
  // "now" is a live concept: a scheduled recap of a past day omits it.
  if (opts.includePresenceNow ?? true) {
    const staleFlag = f.stale ? '  ⚠ STALE (sentinel heartbeat lapsed)' : '';
    out.push(`\nPresence now${staleFlag}`);
    if (f.presenceNow.length === 0) {
      out.push(f.heartbeatAt ? '  (nobody in monitored files)' : '  (no sentinel reporting)');
    } else {
      for (const p of f.presenceNow) {
        const users = p.users.map((u) => `${u.handle} (${formatDuration(u.minutes)})`).join(', ');
        out.push(`  ● ${p.fileName}: ${users}`);
      }
    }
  }

  // Per-member activity today (events → estimated bursts; measured in-file).
  if (f.members.length > 0) {
    out.push('\nMember activity today (burst times are estimates)');
    const rows = f.members.map((m) => [
      (m.discordName ?? m.handle) + (m.mapped ? '' : ' ⚠'),
      String(m.eventCount),
      m.estBurstMinutes > 0 ? `~${formatDuration(m.estBurstMinutes)}` : '—',
      m.presenceMinutes > 0 ? formatDuration(m.presenceMinutes) : '—',
    ]);
    out.push(table(['Member', 'Events', 'Est. burst', 'In-file'], rows));
    if (f.members.some((m) => !m.mapped)) out.push('  ⚠ = not mapped to a Discord user (run `figma map-members`)');
  }

  // File heat.
  if (f.fileHeat.length > 0) {
    out.push('\nFile heat');
    const rows = f.fileHeat.map((h) => [
      h.name,
      String(h.events),
      formatTime(h.lastTouchAt, tz),
      h.lastEditor,
    ]);
    out.push(table(['File', 'Events', 'Last touch', 'Last editor'], rows));
  }

  // Recent events (most recent first, capped for readability).
  if (f.events.length > 0) {
    out.push('\nRecent events');
    for (const e of f.events.slice(0, 15)) {
      out.push(`  [${formatTime(e.at, tz)}] ${e.handle} — ${FIGMA_EVENT_LABEL[e.eventType] ?? e.eventType} — ${e.fileName}`);
    }
  }

  if (f.presenceNow.length === 0 && f.members.length === 0 && f.events.length === 0) {
    out.push('\n(no figma activity recorded for this day)');
  }
  return out.join('\n');
}
