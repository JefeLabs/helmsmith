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
import type {
  DailySummary,
  FigmaDailySummary,
  UserDayRow,
  UserWeekRow,
  WeeklySummary,
} from '../reports/types.js';
import { weekGrid } from '../reports/weekGrid.js';
import {
  dailyColumns,
  figmaCorrelationLine,
  figmaEventLine,
  figmaFileLine,
  figmaMemberLine,
  figmaPresenceLine,
  type Period,
  pageDate,
  sparkline,
  weeklyColumns,
} from './model.js';

/** Presence-now/live-log refresh cadence while the Figma panel is visible. */
const FIGMA_REFRESH_MS = 30_000;

export interface SummaryViewProps {
  reports: ReportService;
  timezone: string;
  initialPeriod: Period;
  initialDate: string;
  onQuit: () => void;
}

const HELP =
  '[d] daily  [w] weekly  [f] figma  [←/→] page  [↑/↓] move  [enter] detail  [q] quit';

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
  const [showFigma, setShowFigma] = useState(false);
  const [figma, setFigma] = useState<FigmaDailySummary | null>(null);

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

  // The Figma panel refreshes on a timer while visible: presence-now and the
  // live log change without keyboard input (the tracker writes continuously).
  useEffect(() => {
    if (!showFigma) return;
    let live = true;
    const load = () =>
      reports.figmaDaily(date).then((f) => {
        if (live) setFigma(f);
      });
    setFigma(null);
    void load();
    const timer = setInterval(() => void load(), FIGMA_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [showFigma, date, reports]);

  useKeybinding('d', 'daily', () => {
    setShowFigma(false);
    setPeriod('daily');
  });
  useKeybinding('w', 'weekly', () => {
    setShowFigma(false);
    setPeriod('weekly');
  });
  useKeybinding('f', 'figma', () => setShowFigma((v) => !v));
  useKeybinding('left', 'prev', () => setDate((d) => pageDate(d, -1, period)));
  useKeybinding('right', 'next', () => setDate((d) => pageDate(d, 1, period)));
  useKeybinding('q', 'quit', () => onQuit());

  const title = showFigma
    ? `Figma  ${date}`
    : summary?.period === 'weekly'
      ? `Weekly  ${summary.from} → ${summary.to}`
      : `Daily  ${date}`;

  return (
    <Box style={{ flexDirection: 'column', padding: 1, gap: 1 }}>
      <Heading>{`⏱  Time Tracker — ${title}`}</Heading>
      <Text variant="muted">{HELP}</Text>
      {showFigma ? (
        <FigmaPanel figma={figma} tz={timezone} />
      ) : summary === null ? (
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

/**
 * The Figma panel (PRD §5): Presence Now (measured, ⚠ STALE when the sentinel
 * heartbeat lapses) · per-member daily activity · file heat · live event log.
 */
function FigmaPanel({ figma, tz }: { figma: FigmaDailySummary | null; tz: string }) {
  if (figma === null) return <Text variant="muted">Loading…</Text>;
  if (!figma.available) {
    return (
      <Text variant="muted">
        Figma tracking is not available on this storage backend (sqlite only).
      </Text>
    );
  }
  const empty =
    figma.events.length === 0 && figma.members.length === 0 && figma.presenceNow.length === 0;
  return (
    <Box style={{ flexDirection: 'column', gap: 1 }}>
      <Box style={{ flexDirection: 'column' }}>
        <Heading>{`Presence now${figma.stale ? '  ⚠ STALE (sentinel heartbeat lapsed)' : ''}`}</Heading>
        {figma.presenceNow.length === 0 ? (
          <Text variant="muted">
            {figma.heartbeatAt ? 'Nobody in monitored files.' : 'No sentinel reporting.'}
          </Text>
        ) : (
          figma.presenceNow.map((p) => <Text key={p.fileKey}>{figmaPresenceLine(p)}</Text>)
        )}
      </Box>
      {empty ? (
        <Text variant="muted">No Figma activity recorded for this day.</Text>
      ) : (
        <>
          <Box style={{ flexDirection: 'column' }}>
            <Heading>Member activity (bursts are estimates)</Heading>
            {figma.members.map((m) => (
              <Text key={m.figmaUserId}>{figmaMemberLine(m)}</Text>
            ))}
          </Box>
          <Box style={{ flexDirection: 'column' }}>
            <Heading>File heat</Heading>
            {figma.fileHeat.map((f) => (
              <Text key={f.fileKey}>{figmaFileLine(f, tz)}</Text>
            ))}
          </Box>
          <Box style={{ flexDirection: 'column' }}>
            <Heading>Live log</Heading>
            {figma.events.slice(0, 15).map((e, i) => (
              <Text key={`${e.at}-${i}`} variant="muted">
                {figmaEventLine(e, tz)}
              </Text>
            ))}
          </Box>
        </>
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
      {row.figma && <Text>{`Figma:   ${figmaCorrelationLine(row.figma)}`}</Text>}
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
