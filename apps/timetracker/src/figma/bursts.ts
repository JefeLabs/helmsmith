/**
 * Burst inference (PRD §4.4): Figma events are debounced and coarse, so work
 * sessions can only be ESTIMATED by clustering — events by the same user
 * separated by ≤ gapMin merge into one burst. Derived at read time from
 * figma_events, never stored: recomputing is cheap at this team's volume and
 * a config change (gap/pad) retroactively applies everywhere.
 *
 * Pad placement: the pad extends the burst BACKWARD (start = first − pad).
 * FILE_UPDATE webhooks fire after editing stops or well into it, so the work
 * behind an event precedes its timestamp; padding backward also makes bursts
 * overlap the day-session they belong to instead of leaking past its end.
 */
import type { FigmaBurst, FigmaEvent } from './types.js';

export interface BurstConfig {
  /** Events ≤ this many minutes apart merge into one burst. */
  gapMin: number;
  /** Minutes added before the first event (webhook debounce compensation). */
  padMin: number;
}

/** The Discord day-session window a burst may attribute to. */
export interface SessionWindow {
  startAt: string;
  /** Absent while the day is still open (no summary posted yet). */
  endAt?: string;
}

const MIN_MS = 60_000;

/**
 * Cluster ONE user's events into bursts. Events may arrive unsorted (webhook
 * and poll interleave); they are sorted by timestamp here. Events without a
 * parseable timestamp are ignored.
 */
export function clusterBursts(
  events: ReadonlyArray<Pick<FigmaEvent, 'at' | 'figmaUserId'>>,
  cfg: BurstConfig,
): FigmaBurst[] {
  const times = events
    .map((e) => ({ ms: Date.parse(e.at), user: e.figmaUserId ?? '' }))
    .filter((t) => Number.isFinite(t.ms))
    .sort((a, b) => a.ms - b.ms);
  if (times.length === 0) return [];

  const gapMs = cfg.gapMin * MIN_MS;
  const bursts: FigmaBurst[] = [];
  let first = times[0];
  let last = times[0];
  let count = 1;

  const flush = () => {
    bursts.push({
      figmaUserId: first.user,
      startAt: new Date(first.ms - cfg.padMin * MIN_MS).toISOString(),
      endAt: new Date(last.ms).toISOString(),
      eventCount: count,
      estMinutes: Math.round((last.ms - first.ms) / MIN_MS) + cfg.padMin,
      inSession: false, // attribution happens in attributeBursts
    });
  };

  for (const t of times.slice(1)) {
    if (t.ms - last.ms <= gapMs) {
      last = t;
      count++;
    } else {
      flush();
      first = t;
      last = t;
      count = 1;
    }
  }
  flush();
  return bursts;
}

/**
 * Tag bursts that overlap the member's Discord day-session (goals→summary).
 * An open session (no summary yet) extends to `now`. No session → all bursts
 * stay unattributed — still shown, labeled "outside session".
 */
export function attributeBursts(
  bursts: FigmaBurst[],
  session: SessionWindow | undefined,
  now: Date,
): FigmaBurst[] {
  if (!session) return bursts;
  const winStart = Date.parse(session.startAt);
  const winEnd = session.endAt ? Date.parse(session.endAt) : now.getTime();
  return bursts.map((b) => ({
    ...b,
    inSession: Date.parse(b.startAt) <= winEnd && Date.parse(b.endAt) >= winStart,
  }));
}

/** Group events by figma user and cluster each user's stream independently. */
export function burstsByUser(
  events: ReadonlyArray<Pick<FigmaEvent, 'at' | 'figmaUserId'>>,
  cfg: BurstConfig,
): Map<string, FigmaBurst[]> {
  const byUser = new Map<string, Array<Pick<FigmaEvent, 'at' | 'figmaUserId'>>>();
  for (const e of events) {
    if (!e.figmaUserId) continue; // unattributed events can't form a user burst
    const list = byUser.get(e.figmaUserId);
    if (list) list.push(e);
    else byUser.set(e.figmaUserId, [e]);
  }
  const out = new Map<string, FigmaBurst[]>();
  for (const [user, list] of byUser) out.set(user, clusterBursts(list, cfg));
  return out;
}

/** Total estimated minutes across bursts — always displayed with ~/est. */
export function totalEstMinutes(bursts: ReadonlyArray<FigmaBurst>): number {
  return bursts.reduce((n, b) => n + b.estMinutes, 0);
}
