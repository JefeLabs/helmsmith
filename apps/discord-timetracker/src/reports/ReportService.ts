/**
 * The shared read model. Reads through the StorageAdapter and folds sample
 * counts into minutes. Depends on nothing Discord — the same instance powers
 * the `report` CLI, the TUI viewer, and scheduled Discord summaries.
 */
import { POLL_INTERVAL_MINUTES } from '../domain/constants.js';
import { addDays, type WeekStart, weekWindow } from '../domain/dayKey.js';
import type { DailyActivity, ISODate } from '../domain/types.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { DailySummary, UserDayRow, UserWeekRow, WeeklySummary } from './types.js';

const toMinutes = (samples: number) => samples * POLL_INTERVAL_MINUTES;

export class ReportService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly weekStartsOn: WeekStart = 'monday',
  ) {}

  async daily(date: ISODate): Promise<DailySummary> {
    const [rows, names] = await Promise.all([
      this.storage.listDay(date),
      this.storage.getUserNames(),
    ]);
    const users = rows.map(toUserDayRow).sort(byOnlineDesc);
    for (const u of users) u.displayName = names[u.userId];
    return { period: 'daily', date, users };
  }

  async weekly(anchor: ISODate): Promise<WeeklySummary> {
    const { from, to } = weekWindow(anchor, this.weekStartsOn);
    const [rows, names] = await Promise.all([
      this.storage.listRange(from, to),
      this.storage.getUserNames(),
    ]);
    const summary = aggregateWeekly(from, to, rows);
    for (const u of summary.users) u.displayName = names[u.userId];
    return summary;
  }
}

function toUserDayRow(a: DailyActivity): UserDayRow {
  return {
    userId: a.userId,
    onlineMinutes: toMinutes(a.presence.online),
    voiceMinutes: toMinutes(a.engagementVoiceSamples),
    startedAt: a.startOfDay?.at,
    endedAt: a.endOfDay?.at,
    ciSubmissions: a.ciSubmissions,
    engagementMessages: a.engagementMessages,
  };
}

const byOnlineDesc = <T extends { onlineMinutes: number; userId: string }>(a: T, b: T) =>
  b.onlineMinutes - a.onlineMinutes || a.userId.localeCompare(b.userId);

function aggregateWeekly(from: ISODate, to: ISODate, rows: DailyActivity[]): WeeklySummary {
  // Every day in the inclusive window, so perDay is dense (0-filled) for sparklines.
  const days: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  const byUser = new Map<string, DailyActivity[]>();
  for (const r of rows) {
    const list = byUser.get(r.userId);
    if (list) list.push(r);
    else byUser.set(r.userId, [r]);
  }

  const users: UserWeekRow[] = [...byUser.entries()].map(([userId, recs]) => {
    const byDate = new Map(recs.map((r) => [r.date, r]));
    const sum = (pick: (a: DailyActivity) => number) => recs.reduce((n, r) => n + pick(r), 0);
    return {
      userId,
      onlineMinutes: toMinutes(sum((r) => r.presence.online)),
      voiceMinutes: toMinutes(sum((r) => r.engagementVoiceSamples)),
      ciSubmissions: sum((r) => r.ciSubmissions),
      engagementMessages: sum((r) => r.engagementMessages),
      daysActive: recs.length, // listRange yields one record per user/day
      perDay: days.map((date) => ({
        date,
        onlineMinutes: toMinutes(byDate.get(date)?.presence.online ?? 0),
      })),
    };
  });
  users.sort(byOnlineDesc);
  return { period: 'weekly', from, to, users };
}
