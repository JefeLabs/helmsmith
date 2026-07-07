/**
 * Report read-model shapes. These are what the `report` CLI (M5), the TUI (M6),
 * and the scheduled Discord summaries (M7) all render — durations are in
 * minutes (presence/voice samples already folded to minutes by ReportService).
 */
import type { ISODate, UserId } from '../domain/types.js';
import type { FigmaEventType } from '../figma/types.js';

/**
 * Per-member Figma correlation for one day (PRD §5.4). Estimated numbers
 * (bursts) and measured numbers (sentinel presence) are separate fields and
 * must stay visually distinct — renderers mark estimates with ~/"est.".
 */
export interface UserDayFigma {
  eventCount: number;
  byType: Partial<Record<FigmaEventType, number>>;
  /** Inferred burst time in minutes — an ESTIMATE, always rendered with ~. */
  estBurstMinutes: number;
  /** Bursts overlapping the member's goals→summary day-session. */
  burstsInSession: number;
  bursts: number;
  /** Measured sentinel in-file minutes (monitored files only) — no ~ marker. */
  presenceMinutes: number;
  /** File names touched today, by event count (capped for display). */
  topFiles: string[];
}

export interface UserDayRow {
  userId: UserId;
  displayName?: string; // resolved from the users table; falls back to userId
  onlineMinutes: number; // raw active ticks (presence.online) × poll interval
  voiceMinutes: number; // engagementVoiceSamples × poll interval
  /** Idle ticks × poll interval. */
  idleMinutes: number;
  /** start-of-day → end-of-day (or last-seen if no end yet), in minutes. */
  spanMinutes: number;
  /** span − idle: working time, lenient on Discord disconnects. */
  activeMinutes: number;
  startedAt?: string; // ISO timestamp of start-of-day post
  endedAt?: string; // ISO timestamp of end-of-day post (undefined → still open)
  ciSubmissions: number;
  engagementMessages: number;
  /** Present when the storage backend tracks Figma and the member has data. */
  figma?: UserDayFigma;
}

export interface DailySummary {
  period: 'daily';
  date: ISODate;
  users: UserDayRow[];
}

// ── Figma panel feed (TUI Figma view + `report --json`) ────────────────

export interface FigmaEventView {
  at: string;
  eventType: FigmaEventType;
  handle: string; // figma handle, '(system)' when unattributed
  fileName: string;
}

export interface FigmaFileHeat {
  fileKey: string;
  name: string;
  events: number;
  lastTouchAt: string;
  lastEditor: string;
}

export interface FigmaMemberDay {
  figmaUserId: string;
  handle: string;
  /** Discord display name when mapped; undefined = unmapped (surfaced in UI). */
  discordName?: string;
  mapped: boolean;
  eventCount: number;
  byType: Partial<Record<FigmaEventType, number>>;
  estBurstMinutes: number;
  presenceMinutes: number;
}

export interface FigmaPresenceNow {
  fileKey: string;
  fileName: string;
  users: Array<{ handle: string; minutes: number }>;
}

export interface FigmaDailySummary {
  date: ISODate;
  /** False when the storage backend has no Figma support — hide the panel. */
  available: boolean;
  events: FigmaEventView[]; // newest first, capped
  fileHeat: FigmaFileHeat[];
  members: FigmaMemberDay[];
  presenceNow: FigmaPresenceNow[];
  /** Last accepted sentinel snapshot; undefined = sentinel never reported. */
  heartbeatAt?: string;
  /** True when the heartbeat is older than the configured staleness window. */
  stale: boolean;
}

export interface UserWeekRow {
  userId: UserId;
  displayName?: string;
  onlineMinutes: number; // summed across the window
  activeMinutes: number; // summed span−idle across the window
  voiceMinutes: number;
  ciSubmissions: number;
  engagementMessages: number;
  daysActive: number; // days with any tracked record
  /** Dense per-day series (0-filled) — drives the workweek grid + TUI sparkline. */
  perDay: { date: ISODate; onlineMinutes: number; activeMinutes: number; idleMinutes: number }[];
}

export interface WeeklySummary {
  period: 'weekly';
  from: ISODate;
  to: ISODate;
  users: UserWeekRow[];
}

export type Summary = DailySummary | WeeklySummary;
