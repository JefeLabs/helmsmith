/**
 * The shared read model. Reads through the StorageAdapter and folds sample
 * counts into minutes. Depends on nothing Discord — the same instance powers
 * the `report` CLI, the TUI viewer, and scheduled Discord summaries.
 */
import { POLL_INTERVAL_MINUTES } from '../domain/constants.js';
import { addDays, type WeekStart, weekWindow } from '../domain/dayKey.js';
import { isTracked } from '../domain/tracked.js';
import type { DailyActivity, ISODate, UserId } from '../domain/types.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { DailySummary, UserDayRow, UserWeekRow, WeeklySummary } from './types.js';

const toMinutes = (samples: number) => samples * POLL_INTERVAL_MINUTES;

export class ReportService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly weekStartsOn: WeekStart = 'monday',
    /** When non-empty, reports include only these users. */
    private readonly trackedUserIds: readonly UserId[] = [],
  ) {}

  /** `now` bounds the span when a user hasn't posted end-of-day yet; injectable for tests. */
  async daily(date: ISODate, now: Date = new Date()): Promise<DailySummary> {
    const [rows, names] = await Promise.all([
      this.storage.listDay(date),
      this.storage.getUserNames(),
    ]);
    const users = rows
      .filter((a) => isTracked(a.userId, this.trackedUserIds))
      .map((a) => toUserDayRow(a, now))
      .sort(byActiveDesc);
    for (const u of users) u.displayName = names[u.userId];
    return { period: 'daily', date, users };
  }

  async weekly(anchor: ISODate): Promise<WeeklySummary> {
    const { from, to } = weekWindow(anchor, this.weekStartsOn);
    const [rows, names] = await Promise.all([
      this.storage.listRange(from, to),
      this.storage.getUserNames(),
    ]);
    const tracked = rows.filter((a) => isTracked(a.userId, this.trackedUserIds));
    const summary = aggregateWeekly(from, to, tracked);
    for (const u of summary.users) u.displayName = names[u.userId];
    return summary;
  }
}

/**
 * span = (end-of-day | last-seen present | now) − (start-of-day | first-seen).
 * Returns 0 when the day never started. The fallbacks let an in-progress day
 * still show a running span without an end-of-day post.
 */
function spanMinutesOf(a: DailyActivity, now: Date): number {
  const startIso = a.startOfDay?.at ?? a.presence.firstOnlineAt;
  if (!startIso) return 0;
  const endIso = a.endOfDay?.at ?? a.presence.lastOnlineAt ?? now.toISOString();
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

function toUserDayRow(a: DailyActivity, now: Date): UserDayRow {
  const idleMinutes = toMinutes(a.presence.idle);
  const spanMinutes = spanMinutesOf(a, now);
  return {
    userId: a.userId,
    onlineMinutes: toMinutes(a.presence.online),
    voiceMinutes: toMinutes(a.engagementVoiceSamples),
    idleMinutes,
    spanMinutes,
    activeMinutes: Math.max(0, spanMinutes - idleMinutes),
    startedAt: a.startOfDay?.at,
    endedAt: a.endOfDay?.at,
    ciSubmissions: a.ciSubmissions,
    engagementMessages: a.engagementMessages,
  };
}

const byActiveDesc = <T extends { activeMinutes: number; userId: string }>(a: T, b: T) =>
  b.activeMinutes - a.activeMinutes || a.userId.localeCompare(b.userId);

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
