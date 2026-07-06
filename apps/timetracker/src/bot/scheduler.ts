/**
 * Scheduled summary push (M7). The decision logic (`dueReports`) is pure and
 * tested; `attachScheduler` polls it each minute and posts to the report
 * channel. Last-run markers persist via storage `meta`, so a restart after the
 * post time never re-posts the same day/week.
 */
import { type Client, Events } from 'discord.js';
import { addDays, dayKeyFor, type WeekStart, weekdayOf, weekWindow } from '../domain/dayKey.js';
import type { DailyActivity, ISODate, UserId } from '../domain/types.js';
import { dailyMessage, weeklyMessage } from '../reports/discord.js';
import type { ReportService } from '../reports/ReportService.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import type { BotDeps } from './handlers.js';

const META_KEY = 'scheduler';

export interface ScheduleConfig {
  timezone: string;
  weekStartsOn: WeekStart;
  dailyAt: string; // 'HH:MM' local
}

/** Config for the current-day end-of-day publish (distinct from `dailyAt`). */
export interface EndOfDayConfig {
  enabled: boolean;
  mode: 'fixed' | 'completion';
  at: string; // 'HH:MM' — used when mode = 'fixed'
  deadlineAt: string; // 'HH:MM' — fallback when mode = 'completion'
  weekdaysOnly: boolean;
  timezone: string;
}

export interface ScheduleState {
  lastDailyRunDay?: ISODate; // local day we last posted the daily report
  lastWeeklyRunWeek?: ISODate; // week-start day we last posted the weekly report
  lastEodPublishDay?: ISODate; // local day we last posted the end-of-day report
}

export interface DueResult {
  daily?: ISODate; // day-key to report (the previous day)
  weekly?: ISODate; // anchor day in the previous week
  state: ScheduleState;
}

function localHHMM(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/**
 * Decide what to post. "At or after `dailyAt`, once per local day" (not "fire
 * exactly at HH:MM") so a late start still catches up. On the week-start day it
 * also posts the previous week. Pure: same inputs → same output.
 */
export function dueReports(now: Date, cfg: ScheduleConfig, state: ScheduleState): DueResult {
  const result: DueResult = { state: { ...state } };
  const localDay = dayKeyFor(now, cfg.timezone);
  if (localHHMM(now, cfg.timezone) < cfg.dailyAt) return result; // not time yet today

  if (state.lastDailyRunDay !== localDay) {
    result.daily = addDays(localDay, -1); // yesterday's complete day
    result.state.lastDailyRunDay = localDay;
  }

  const week = weekWindow(localDay, cfg.weekStartsOn);
  if (week.from === localDay && state.lastWeeklyRunWeek !== week.from) {
    result.weekly = addDays(localDay, -1); // yesterday sits in the previous week
    result.state.lastWeeklyRunWeek = week.from;
  }
  return result;
}

/**
 * Decide whether to publish TODAY's end-of-day report (the current day, once).
 * `fixed` fires at/after `at`; `completion` fires as soon as every tracked user
 * has logged end-of-day, else at/after `deadlineAt`. Pure: same inputs → same
 * output. Returns the day to publish plus the next state.
 */
export function dueEndOfDay(
  now: Date,
  cfg: EndOfDayConfig,
  trackedUserIds: readonly UserId[],
  todayRows: DailyActivity[],
  state: ScheduleState,
): { publish?: ISODate; state: ScheduleState } {
  const result: { publish?: ISODate; state: ScheduleState } = { state: { ...state } };
  if (!cfg.enabled) return result;
  const localDay = dayKeyFor(now, cfg.timezone);
  if (state.lastEodPublishDay === localDay) return result; // already published today
  const weekday = weekdayOf(localDay); // 0=Sun..6=Sat
  if (cfg.weekdaysOnly && (weekday === 0 || weekday === 6)) return result; // weekend

  const hhmm = localHHMM(now, cfg.timezone);
  let due: boolean;
  if (cfg.mode === 'fixed') {
    due = hhmm >= cfg.at;
  } else {
    const allDone =
      trackedUserIds.length > 0 &&
      trackedUserIds.every((id) => todayRows.find((r) => r.userId === id)?.endOfDay !== undefined);
    due = allDone || hhmm >= cfg.deadlineAt;
  }
  if (due) {
    result.publish = localDay;
    result.state.lastEodPublishDay = localDay;
  }
  return result;
}

async function loadState(storage: StorageAdapter): Promise<ScheduleState> {
  const raw = await storage.getMeta(META_KEY);
  return raw ? (JSON.parse(raw) as ScheduleState) : {};
}

/** Attach the minute-poll scheduler. Returns a stop fn. No-op when disabled. */
export function attachScheduler(client: Client, deps: BotDeps, reports: ReportService): () => void {
  if (!deps.config.schedule.enabled) return () => {};
  const cfg: ScheduleConfig = {
    timezone: deps.config.timezone,
    weekStartsOn: deps.config.weekStartsOn,
    dailyAt: deps.config.schedule.dailyAt,
  };
  const eodCfg: EndOfDayConfig = {
    ...deps.config.schedule.endOfDay,
    timezone: deps.config.timezone,
  };
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    const now = new Date();
    // dueReports → previous-day recap at `dailyAt`; dueEndOfDay → current-day
    // publish (fixed time or all-tracked-done/deadline). Both thread one state.
    const due = dueReports(now, cfg, await loadState(deps.storage));
    const eod = eodCfg.enabled
      ? dueEndOfDay(
          now,
          eodCfg,
          deps.config.trackedUserIds,
          await deps.storage.listDay(dayKeyFor(now, eodCfg.timezone)),
          due.state,
        )
      : { state: due.state };
    if (!due.daily && !due.weekly && !eod.publish) return;

    const channel = await client.channels.fetch(deps.config.reportChannelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
      console.error('  ! scheduler: report channel is not a sendable text channel');
      return;
    }
    if (due.daily) await channel.send(await dailyMessage(reports, due.daily, cfg.timezone));
    if (due.weekly) await channel.send(await weeklyMessage(reports, due.weekly, cfg.timezone));
    if (eod.publish) await channel.send(await dailyMessage(reports, eod.publish, cfg.timezone));
    // Persist AFTER a successful post so a crash mid-post retries next minute.
    await deps.storage.setMeta(META_KEY, JSON.stringify(eod.state));
    console.log(
      `  ✓ posted scheduled summary (daily=${due.daily ?? '–'} weekly=${due.weekly ?? '–'} eod=${eod.publish ?? '–'})`,
    );
  };

  client.once(Events.ClientReady, () => {
    timer = setInterval(() => {
      void tick().catch((err) => console.error('  ! scheduler tick error:', err));
    }, 60_000);
    const eodNote = eodCfg.enabled
      ? ` · end-of-day ${eodCfg.mode === 'fixed' ? `at ${eodCfg.at}` : `on completion (deadline ${eodCfg.deadlineAt})`}`
      : '';
    console.log(`  ✓ scheduled summaries at ${cfg.dailyAt} ${cfg.timezone}${eodNote}`);
  });

  return () => {
    if (timer) clearInterval(timer);
  };
}
