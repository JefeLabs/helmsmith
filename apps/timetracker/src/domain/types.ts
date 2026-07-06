/**
 * Core domain types. One logical record per user per local-timezone day —
 * see .plan/01-overview.md. Presence is stored aggregated (a running count of
 * 5-minute samples) rather than as raw samples; at 288 samples/user/day that
 * keeps the row small while still yielding online-hours for reports.
 */

/** A local calendar day, `YYYY-MM-DD`. Always computed in the configured tz. */
export type ISODate = string;

/** A Discord snowflake (user/channel/role id). */
export type UserId = string;

export interface StartOfDay {
  at: string; // ISO timestamp of the first goals post
  messageId: string;
  goals: string;
}

export interface EndOfDay {
  at: string; // ISO timestamp of the final summary post
  messageId: string;
  summary: string;
}

export interface PresenceAggregate {
  samples: number; // total 5-min ticks the user was present (active or idle)
  online: number; // ticks where status was active (online/dnd) — excludes idle
  idle: number; // ticks where status was idle (away)
  firstOnlineAt?: string; // first tick seen present (active or idle)
  lastOnlineAt?: string; // last tick seen present — provisional "end" for span
}

export interface DailyActivity {
  userId: UserId;
  date: ISODate;
  startOfDay?: StartOfDay;
  endOfDay?: EndOfDay;
  presence: PresenceAggregate;
  ciSubmissions: number;
  /** Text messages in #DevOffice (the voice channel's chat). */
  engagementMessages: number;
  /** 5-min ticks connected to the #DevOffice voice channel. minutes ≈ × interval. */
  engagementVoiceSamples: number;
  updatedAt: string;
}

/** A factory for an empty day record — keeps counter defaults in one place. */
export function emptyDay(userId: UserId, date: ISODate, now: string): DailyActivity {
  return {
    userId,
    date,
    presence: { samples: 0, online: 0, idle: 0 },
    ciSubmissions: 0,
    engagementMessages: 0,
    engagementVoiceSamples: 0,
    updatedAt: now,
  };
}
