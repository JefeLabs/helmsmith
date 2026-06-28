/**
 * Pure view-model for the TUI (M6) — no React, no openTUI, so it's unit-testable.
 * The SummaryView component renders these column defs + helpers; this module
 * holds the logic worth testing (date paging, column shape, sparkline).
 */
import type { TableColumn } from '@ecruz165/tui-view-components/organisms';
import { addDays } from '../domain/dayKey.js';
import type { ISODate } from '../domain/types.js';
import { formatDuration, formatTime } from '../reports/render.js';
import type { UserDayRow, UserWeekRow } from '../reports/types.js';

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

export function weeklyColumns(): TableColumn<UserWeekRow>[] {
  return [
    { key: 'userId', label: 'User', width: 20, render: (r) => r.displayName ?? r.userId },
    { key: 'online', label: 'Online', width: 9, render: (r) => formatDuration(r.onlineMinutes) },
    { key: 'voice', label: 'Voice', width: 9, render: (r) => formatDuration(r.voiceMinutes) },
    { key: 'ci', label: 'CI', width: 4, align: 'right', render: (r) => String(r.ciSubmissions) },
    {
      key: 'msgs',
      label: 'Msgs',
      width: 5,
      align: 'right',
      render: (r) => String(r.engagementMessages),
    },
    { key: 'days', label: 'Days', width: 5, render: (r) => `${r.daysActive}/7` },
    {
      key: 'trend',
      label: 'Trend',
      width: 9,
      render: (r) => sparkline(r.perDay.map((d) => d.onlineMinutes)),
    },
  ];
}
