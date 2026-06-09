/**
 * Scheduled summary push (M7). The decision logic (`dueReports`) is pure and
 * tested; `attachScheduler` polls it each minute and posts to the report
 * channel. Last-run markers persist via storage `meta`, so a restart after the
 * post time never re-posts the same day/week.
 */
import { type Client, Events } from 'discord.js';
import { addDays, dayKeyFor, type WeekStart, weekWindow } from '../domain/dayKey.js';
import type { ISODate } from '../domain/types.js';
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

export interface ScheduleState {
  lastDailyRunDay?: ISODate; // local day we last posted the daily report
  lastWeeklyRunWeek?: ISODate; // week-start day we last posted the weekly report
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
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    const due = dueReports(new Date(), cfg, await loadState(deps.storage));
    if (!due.daily && !due.weekly) return;

    const channel = await client.channels.fetch(deps.config.reportChannelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
      console.error('  ! scheduler: report channel is not a sendable text channel');
      return;
    }
    if (due.daily) await channel.send(await dailyMessage(reports, due.daily, cfg.timezone));
    if (due.weekly) await channel.send(await weeklyMessage(reports, due.weekly, cfg.timezone));
    // Persist AFTER a successful post so a crash mid-post retries next minute.
    await deps.storage.setMeta(META_KEY, JSON.stringify(due.state));
    console.log(
      `  ✓ posted scheduled summary (daily=${due.daily ?? '–'} weekly=${due.weekly ?? '–'})`,
    );
  };

  client.once(Events.ClientReady, () => {
    timer = setInterval(() => {
      void tick().catch((err) => console.error('  ! scheduler tick error:', err));
    }, 60_000);
    console.log(`  ✓ scheduled summaries at ${cfg.dailyAt} ${cfg.timezone}`);
  });

  return () => {
    if (timer) clearInterval(timer);
  };
}
