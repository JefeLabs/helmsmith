/**
 * Pure view-model for the TUI (M6) — no React, no openTUI, so it's unit-testable.
 * The SummaryView component renders these column defs + helpers; this module
 * holds the logic worth testing (date paging, column shape, sparkline).
 */
import type { TableColumn } from '@helmsmith/tui-view-components/organisms';
import { addDays } from '../domain/dayKey.js';
import type { ISODate } from '../domain/types.js';
import type { FigmaEventType } from '../figma/types.js';
import { formatDuration, formatTime } from '../reports/render.js';
import type {
  FigmaEventView,
  FigmaFileHeat,
  FigmaMemberDay,
  FigmaPresenceNow,
  UserDayFigma,
  UserDayRow,
  UserWeekRow,
} from '../reports/types.js';
import { WEEKDAYS, weekGrid } from '../reports/weekGrid.js';

export type Period = 'daily' | 'weekly';

/** Page the anchor date by one unit: ±1 day (daily) or ±7 days (weekly). */
export function pageDate(date: ISODate, dir: -1 | 1, period: Period): ISODate {
  return addDays(date, dir * (period === 'weekly' ? 7 : 1));
}

/** Unicode block sparkline for a series (e.g. per-day online minutes). */
export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const blocks = ' ▁▂▃▄▅▆▇█';
  const max = Math.max(1, ...values);
  return values.map((v) => blocks[Math.round((v / max) * (blocks.length - 1))]).join('');
}

export function dailyColumns(tz: string): TableColumn<UserDayRow>[] {
  return [
    { key: 'userId', label: 'User', width: 20, render: (r) => r.displayName ?? r.userId },
    { key: 'online', label: 'Online', width: 8, render: (r) => formatDuration(r.onlineMinutes) },
    { key: 'voice', label: 'Voice', width: 8, render: (r) => formatDuration(r.voiceMinutes) },
    { key: 'ci', label: 'CI', width: 4, align: 'right', render: (r) => String(r.ciSubmissions) },
    {
      key: 'msgs',
      label: 'Msgs',
      width: 5,
      align: 'right',
      render: (r) => String(r.engagementMessages),
    },
    { key: 'start', label: 'Start', width: 6, render: (r) => formatTime(r.startedAt, tz) },
    { key: 'end', label: 'End', width: 6, render: (r) => formatTime(r.endedAt, tz) },
  ];
}

// ── Figma panel lines (PRD §5) — pure string builders, unit-testable ────
// Hard display rule: burst times carry ~/est. (inferred); sentinel in-file
// times are measured and never carry the marker.

export const FIGMA_EVENT_LABEL: Record<FigmaEventType, string> = {
  file_update: 'file updated',
  version: 'version saved',
  comment: 'comment',
  library_publish: 'library publish',
  file_delete: 'file deleted',
};

/** `[14:32] ana — version saved — design-system` (Figma Live Log, §5.1). */
export function figmaEventLine(e: FigmaEventView, tz: string): string {
  return `[${formatTime(e.at, tz)}] ${e.handle} — ${FIGMA_EVENT_LABEL[e.eventType]} — ${e.fileName}`;
}

/** Per-member daily activity row (§5.2), flagging unmapped members (§7). */
export function figmaMemberLine(m: FigmaMemberDay): string {
  const name = m.discordName ?? m.handle;
  const est = m.estBurstMinutes > 0 ? `~${formatDuration(m.estBurstMinutes)} est.` : '—';
  const inFile = m.presenceMinutes > 0 ? formatDuration(m.presenceMinutes) : '—';
  const flag = m.mapped ? '' : '   ⚠ unmapped';
  return `${name.padEnd(16)} ${String(m.eventCount).padStart(3)} ev   ${est.padEnd(14)} in-file ${inFile}${flag}`;
}

/** File heat row (§5.3): name, events today, last touch, last editor. */
export function figmaFileLine(f: FigmaFileHeat, tz: string): string {
  return `${f.name.padEnd(24)} ${String(f.events).padStart(3)} ev   last ${formatTime(f.lastTouchAt, tz)} by ${f.lastEditor}`;
}

/** `design-system: ● ana (12m), ● marco (3m)` (Presence Now, §5.5). */
export function figmaPresenceLine(p: FigmaPresenceNow): string {
  const users = p.users.map((u) => `● ${u.handle} (${formatDuration(u.minutes)})`).join(', ');
  return `${p.fileName}: ${users}`;
}

/** The DayDetail correlation row (§5.4) — estimates and measures kept distinct. */
export function figmaCorrelationLine(f: UserDayFigma): string {
  const parts = [
    `${f.eventCount} events`,
    `~${formatDuration(f.estBurstMinutes)} est. (${f.burstsInSession}/${f.bursts} bursts in session)`,
  ];
  if (f.presenceMinutes > 0) parts.push(`in-file ${formatDuration(f.presenceMinutes)}`);
  if (f.topFiles.length > 0) parts.push(f.topFiles.join(', '));
  return parts.join('  ·  ');
}

/** Per-user workweek grid: User · MON–FRI (active|idle) · WK Active · Avg/day. */
export function weeklyColumns(): TableColumn<UserWeekRow>[] {
  return [
    { key: 'userId', label: 'User', width: 16, render: (r) => r.displayName ?? r.userId },
    ...WEEKDAYS.map(
      (wd, i): TableColumn<UserWeekRow> => ({
        key: `wd${i}`,
        label: wd,
        width: 8,
        render: (r) => weekGrid(r).cells[i] ?? '—',
      }),
    ),
    {
      key: 'wk',
      label: 'WK Active',
      width: 9,
      render: (r) => formatDuration(weekGrid(r).wkActiveMinutes),
    },
    {
      key: 'avg',
      label: 'Avg/day',
      width: 8,
      render: (r) => {
        const a = weekGrid(r).avgActiveMinutes;
        return a > 0 ? formatDuration(a) : '—';
      },
    },
  ];
}
