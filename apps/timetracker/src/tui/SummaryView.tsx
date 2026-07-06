/**
 * SummaryView (M6) — the interactive daily/weekly summary screen. Loads from
 * ReportService and renders the Table organism with master/detail. Keybindings:
 * d/w switch period, ←/→ page the date, ↑/↓ move (Table built-in), enter detail,
 * q quit. Rendering only — all testable logic lives in tui/model.ts.
 */
import { Box, Heading, Text } from '@helmsmith/tui-view-components/atoms';
import { useKeybinding } from '@helmsmith/tui-view-components/keyboard';
import { Table } from '@helmsmith/tui-view-components/organisms';
import { useEffect, useState } from 'react';
import type { ReportService } from '../reports/ReportService.js';
import { formatDuration, formatTime } from '../reports/render.js';
import type { DailySummary, UserDayRow, UserWeekRow, WeeklySummary } from '../reports/types.js';
import { weekGrid } from '../reports/weekGrid.js';
import { dailyColumns, type Period, pageDate, sparkline, weeklyColumns } from './model.js';

export interface SummaryViewProps {
  reports: ReportService;
  timezone: string;
  initialPeriod: Period;
  initialDate: string;
  onQuit: () => void;
}

const HELP = '[d] daily  [w] weekly  [←/→] page  [↑/↓] move  [enter] detail  [q] quit';

export function SummaryView({
  reports,
  timezone,
  initialPeriod,
  initialDate,
  onQuit,
}: SummaryViewProps) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [date, setDate] = useState(initialDate);
  const [summary, setSummary] = useState<DailySummary | WeeklySummary | null>(null);

  useEffect(() => {
    let live = true;
    setSummary(null);
    const load = period === 'weekly' ? reports.weekly(date) : reports.daily(date);
    load.then((s) => {
      if (live) setSummary(s);
    });
    return () => {
      live = false;
    };
  }, [period, date, reports]);

  useKeybinding('d', 'daily', () => setPeriod('daily'));
  useKeybinding('w', 'weekly', () => setPeriod('weekly'));
  useKeybinding('left', 'prev', () => setDate((d) => pageDate(d, -1, period)));
  useKeybinding('right', 'next', () => setDate((d) => pageDate(d, 1, period)));
  useKeybinding('q', 'quit', () => onQuit());

  const title =
    summary?.period === 'weekly' ? `Weekly  ${summary.from} → ${summary.to}` : `Daily  ${date}`;

  return (
    <Box style={{ flexDirection: 'column', padding: 1, gap: 1 }}>
      <Heading>{`⏱  Time Tracker — ${title}`}</Heading>
      <Text variant="muted">{HELP}</Text>
      {summary === null ? (
        <Text variant="muted">Loading…</Text>
      ) : summary.users.length === 0 ? (
        <Text variant="muted">No activity recorded for this period.</Text>
      ) : summary.period === 'daily' ? (
        <Table<UserDayRow>
          rows={summary.users}
          columns={dailyColumns(timezone)}
          rowKey="userId"
          selectable
          pinHeader
          renderDetail={(u) => <DayDetail row={u} tz={timezone} />}
        />
      ) : (
        <Table<UserWeekRow>
          rows={summary.users}
          columns={weeklyColumns()}
          rowKey="userId"
          selectable
          pinHeader
          renderDetail={(u) => <WeekDetail row={u} />}
        />
      )}
    </Box>
  );
}

function DayDetail({ row, tz }: { row: UserDayRow; tz: string }) {
  return (
    <Box style={{ flexDirection: 'column', padding: 1, gap: 1 }}>
      <Heading>{row.displayName ?? row.userId}</Heading>
      <Text>{`Online:  ${formatDuration(row.onlineMinutes)}`}</Text>
      <Text>{`Voice:   ${formatDuration(row.voiceMinutes)}`}</Text>
      <Text>{`CI:      ${row.ciSubmissions}`}</Text>
      <Text>{`Msgs:    ${row.engagementMessages}`}</Text>
      <Text>{`Start:   ${formatTime(row.startedAt, tz)}`}</Text>
      <Text>{`End:     ${formatTime(row.endedAt, tz)}`}</Text>
    </Box>
  );
}

function WeekDetail({ row }: { row: UserWeekRow }) {
  const g = weekGrid(row);
  const avg = g.avgActiveMinutes > 0 ? formatDuration(g.avgActiveMinutes) : '—';
  return (
    <Box style={{ flexDirection: 'column', padding: 1, gap: 1 }}>
      <Heading>{row.displayName ?? row.userId}</Heading>
      <Text>{`WK Active: ${formatDuration(g.wkActiveMinutes)}  ·  Avg/day ${avg}  ·  ${row.daysActive}/7 days`}</Text>
      <Text>{`Online:    ${formatDuration(row.onlineMinutes)}    Voice: ${formatDuration(row.voiceMinutes)}`}</Text>
      <Text>{`CI:        ${row.ciSubmissions}    Msgs: ${row.engagementMessages}`}</Text>
      <Text variant="muted">Active / day (Mon→Sun):</Text>
      <Text>{sparkline(row.perDay.map((d) => d.activeMinutes))}</Text>
      {row.perDay.map((d) => (
        <Text key={d.date} variant="muted">{`${d.date}  active ${formatDuration(d.activeMinutes)}  ·  idle ${formatDuration(d.idleMinutes)}`}</Text>
      ))}
    </Box>
  );
}
