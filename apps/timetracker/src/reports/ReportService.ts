/**
 * The shared read model. Reads through the StorageAdapter and folds sample
 * counts into minutes. Depends on nothing Discord — the same instance powers
 * the `report` CLI, the TUI viewer, and scheduled Discord summaries.
 */
import type { Config } from '../config/schema.js';
import { POLL_INTERVAL_MINUTES } from '../domain/constants.js';
import { addDays, type WeekStart, weekWindow } from '../domain/dayKey.js';
import { isTracked } from '../domain/tracked.js';
import type { DailyActivity, ISODate, UserId } from '../domain/types.js';
import { attributeBursts, clusterBursts, totalEstMinutes } from '../figma/bursts.js';
import { FIGMA_META } from '../figma/context.js';
import type { FigmaEvent, FigmaEventType, FigmaPresenceInterval } from '../figma/types.js';
import { type FigmaStorage, supportsFigma } from '../storage/FigmaStorage.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type {
  DailySummary,
  FigmaDailySummary,
  FigmaMemberDay,
  UserDayFigma,
  UserDayRow,
  UserWeekRow,
  WeeklySummary,
} from './types.js';

const toMinutes = (samples: number) => samples * POLL_INTERVAL_MINUTES;

/** Burst/staleness knobs, wired from config.figma when present (PRD defaults). */
export interface FigmaReportOptions {
  gapMin?: number;
  padMin?: number;
  staleAfterSec?: number;
  /** Max rows in the live event log feed. */
  eventLogLimit?: number;
}

/** The one place the config shape maps onto ReportService's knobs. */
export function reportServiceFor(storage: StorageAdapter, config: Config): ReportService {
  return new ReportService(storage, config.weekStartsOn, config.trackedUserIds, {
    gapMin: config.figma?.burstGapMin,
    padMin: config.figma?.burstPadMin,
    staleAfterSec: config.figma?.presence.staleAfterSec,
  });
}

export class ReportService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly weekStartsOn: WeekStart = 'monday',
    /** When non-empty, reports include only these users. */
    private readonly trackedUserIds: readonly UserId[] = [],
    private readonly figmaOpts: FigmaReportOptions = {},
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
    if (supportsFigma(this.storage)) {
      await attachFigmaDay(this.storage, users, date, now, this.burstCfg());
    }
    return { period: 'daily', date, users };
  }

  private burstCfg() {
    return { gapMin: this.figmaOpts.gapMin ?? 30, padMin: this.figmaOpts.padMin ?? 15 };
  }

  /**
   * The Figma panel feed: live event log, per-member day activity, file heat,
   * and sentinel presence-now with staleness. `available: false` (non-figma
   * backend) tells the UI to hide the panel entirely.
   */
  async figmaDaily(date: ISODate, now: Date = new Date()): Promise<FigmaDailySummary> {
    if (!supportsFigma(this.storage)) {
      return { date, available: false, events: [], fileHeat: [], members: [], presenceNow: [], stale: false };
    }
    const s = this.storage;
    const [events, members, presence, files, names, heartbeatAt, openIntervals] =
      await Promise.all([
        s.listFigmaEventsRange(date, date),
        s.listFigmaMembers(),
        s.listFigmaPresenceRange(date, date),
        s.listFigmaFiles(),
        s.getUserNames(),
        s.getMeta(FIGMA_META.presenceHeartbeat),
        s.listOpenFigmaPresence(),
      ]);

    const fileName = new Map(files.map((f) => [f.fileKey, f.name ?? f.fileKey]));
    const memberById = new Map(members.map((m) => [m.figmaUserId, m]));
    const handleOf = (id: string | null) =>
      id === null ? '(system)' : (memberById.get(id)?.handle ?? id);

    const eventViews = [...events]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, this.figmaOpts.eventLogLimit ?? 50)
      .map((e) => ({
        at: e.at,
        eventType: e.eventType,
        handle: handleOf(e.figmaUserId),
        fileName: fileName.get(e.fileKey) ?? e.fileKey,
      }));

    // File heat: events today per file, newest touch + editor.
    const heat = new Map<string, { events: number; lastTouchAt: string; lastEditor: string }>();
    for (const e of events) {
      const h = heat.get(e.fileKey);
      if (!h) {
        heat.set(e.fileKey, { events: 1, lastTouchAt: e.at, lastEditor: handleOf(e.figmaUserId) });
      } else {
        h.events++;
        if (e.at > h.lastTouchAt) {
          h.lastTouchAt = e.at;
          h.lastEditor = handleOf(e.figmaUserId);
        }
      }
    }
    const fileHeat = [...heat.entries()]
      .map(([fileKey, h]) => ({ fileKey, name: fileName.get(fileKey) ?? fileKey, ...h }))
      .sort((a, b) => b.events - a.events);

    // Per-member day rows (mapped or not — unmapped is surfaced, PRD §7).
    const cfg = this.burstCfg();
    const eventsByUser = groupByUser(events);
    const presenceByUser = presenceMinutesByUser(presence, now);
    const memberIds = new Set([...eventsByUser.keys(), ...presenceByUser.keys()]);
    const memberRows: FigmaMemberDay[] = [...memberIds].map((figmaUserId) => {
      const m = memberById.get(figmaUserId);
      const evs = eventsByUser.get(figmaUserId) ?? [];
      return {
        figmaUserId,
        handle: m?.handle ?? figmaUserId,
        discordName: m?.discordUserId ? names[m.discordUserId] : undefined,
        mapped: Boolean(m?.discordUserId),
        eventCount: evs.length,
        byType: countByType(evs),
        estBurstMinutes: totalEstMinutes(clusterBursts(evs, cfg)),
        presenceMinutes: presenceByUser.get(figmaUserId) ?? 0,
      };
    });
    memberRows.sort((a, b) => b.eventCount - a.eventCount || a.handle.localeCompare(b.handle));

    // Presence Now: open intervals grouped per file (live in-file users).
    const nowByFile = new Map<string, Array<{ handle: string; minutes: number }>>();
    for (const iv of openIntervals) {
      const list = nowByFile.get(iv.fileKey) ?? [];
      list.push({
        handle: handleOf(iv.figmaUserId),
        minutes: Math.max(0, Math.round((now.getTime() - Date.parse(iv.startAt)) / 60_000)),
      });
      nowByFile.set(iv.fileKey, list);
    }
    const presenceNow = [...nowByFile.entries()].map(([fileKey, users]) => ({
      fileKey,
      fileName: fileName.get(fileKey) ?? fileKey,
      users: users.sort((a, b) => b.minutes - a.minutes),
    }));

    const staleAfterSec = this.figmaOpts.staleAfterSec ?? 180;
    const stale = heartbeatAt
      ? now.getTime() - Date.parse(heartbeatAt) > staleAfterSec * 1000
      : false;

    return {
      date,
      available: true,
      events: eventViews,
      fileHeat,
      members: memberRows,
      presenceNow,
      heartbeatAt: heartbeatAt ?? undefined,
      stale,
    };
  }

  async weekly(anchor: ISODate, now: Date = new Date()): Promise<WeeklySummary> {
    const { from, to } = weekWindow(anchor, this.weekStartsOn);
    const [rows, names] = await Promise.all([
      this.storage.listRange(from, to),
      this.storage.getUserNames(),
    ]);
    const tracked = rows.filter((a) => isTracked(a.userId, this.trackedUserIds));
    const summary = aggregateWeekly(from, to, tracked, now);
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

/** span − idle, floored at 0 — working time, lenient on Discord disconnects. */
function activeMinutesOf(a: DailyActivity, now: Date): number {
  return Math.max(0, spanMinutesOf(a, now) - toMinutes(a.presence.idle));
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

// ── figma correlation (PRD §4.4 / §5.4) ─────────────────────────────────

function groupByUser(events: FigmaEvent[]): Map<string, FigmaEvent[]> {
  const map = new Map<string, FigmaEvent[]>();
  for (const e of events) {
    if (!e.figmaUserId) continue;
    const list = map.get(e.figmaUserId);
    if (list) list.push(e);
    else map.set(e.figmaUserId, [e]);
  }
  return map;
}

function countByType(events: FigmaEvent[]): Partial<Record<FigmaEventType, number>> {
  const out: Partial<Record<FigmaEventType, number>> = {};
  for (const e of events) out[e.eventType] = (out[e.eventType] ?? 0) + 1;
  return out;
}

/** Minutes per figma user across intervals; open intervals count up to `now`. */
function presenceMinutesByUser(
  intervals: FigmaPresenceInterval[],
  now: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const iv of intervals) {
    const end = iv.endAt ? Date.parse(iv.endAt) : now.getTime();
    const mins = Math.max(0, Math.round((end - Date.parse(iv.startAt)) / 60_000));
    out.set(iv.figmaUserId, (out.get(iv.figmaUserId) ?? 0) + mins);
  }
  return out;
}

/**
 * Attach the per-member correlation block: the member's Figma events (via the
 * identity mapping) clustered into bursts, attributed against their
 * goals→summary session window, plus measured sentinel presence minutes.
 */
async function attachFigmaDay(
  storage: StorageAdapter & FigmaStorage,
  users: UserDayRow[],
  date: ISODate,
  now: Date,
  cfg: { gapMin: number; padMin: number },
): Promise<void> {
  const [events, members, presence, files] = await Promise.all([
    storage.listFigmaEventsRange(date, date),
    storage.listFigmaMembers(),
    storage.listFigmaPresenceRange(date, date),
    storage.listFigmaFiles(),
  ]);
  if (events.length === 0 && presence.length === 0) return;

  const fileName = new Map(files.map((f) => [f.fileKey, f.name ?? f.fileKey]));
  const figmaIdsByDiscord = new Map<string, string[]>();
  for (const m of members) {
    if (!m.discordUserId) continue;
    const list = figmaIdsByDiscord.get(m.discordUserId) ?? [];
    list.push(m.figmaUserId);
    figmaIdsByDiscord.set(m.discordUserId, list);
  }
  const eventsByUser = groupByUser(events);
  const presenceByUser = presenceMinutesByUser(presence, now);

  for (const row of users) {
    const figmaIds = figmaIdsByDiscord.get(row.userId) ?? [];
    if (figmaIds.length === 0) continue;
    const evs = figmaIds.flatMap((id) => eventsByUser.get(id) ?? []);
    const presenceMinutes = figmaIds.reduce((n, id) => n + (presenceByUser.get(id) ?? 0), 0);
    if (evs.length === 0 && presenceMinutes === 0) continue;

    const session = row.startedAt ? { startAt: row.startedAt, endAt: row.endedAt } : undefined;
    const bursts = attributeBursts(clusterBursts(evs, cfg), session, now);
    const fileCounts = new Map<string, number>();
    for (const e of evs) fileCounts.set(e.fileKey, (fileCounts.get(e.fileKey) ?? 0) + 1);
    const topFiles = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => fileName.get(key) ?? key);

    const figma: UserDayFigma = {
      eventCount: evs.length,
      byType: countByType(evs),
      estBurstMinutes: totalEstMinutes(bursts),
      burstsInSession: bursts.filter((b) => b.inSession).length,
      bursts: bursts.length,
      presenceMinutes,
      topFiles,
    };
    row.figma = figma;
  }
}

function aggregateWeekly(
  from: ISODate,
  to: ISODate,
  rows: DailyActivity[],
  now: Date,
): WeeklySummary {
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
    const perDay = days.map((date) => {
      const r = byDate.get(date);
      return {
        date,
        onlineMinutes: toMinutes(r?.presence.online ?? 0),
        activeMinutes: r ? activeMinutesOf(r, now) : 0,
        idleMinutes: toMinutes(r?.presence.idle ?? 0),
      };
    });
    return {
      userId,
      onlineMinutes: toMinutes(sum((r) => r.presence.online)),
      activeMinutes: perDay.reduce((n, d) => n + d.activeMinutes, 0),
      voiceMinutes: toMinutes(sum((r) => r.engagementVoiceSamples)),
      ciSubmissions: sum((r) => r.ciSubmissions),
      engagementMessages: sum((r) => r.engagementMessages),
      daysActive: recs.length, // listRange yields one record per user/day
      perDay,
    };
  });
  users.sort(byActiveDesc);
  return { period: 'weekly', from, to, users };
}
