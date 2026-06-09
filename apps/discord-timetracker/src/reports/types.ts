/**
 * Report read-model shapes. These are what the `report` CLI (M5), the TUI (M6),
 * and the scheduled Discord summaries (M7) all render — durations are in
 * minutes (presence/voice samples already folded to minutes by ReportService).
 */
import type { ISODate, UserId } from '../domain/types.js';

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
}

export interface DailySummary {
  period: 'daily';
  date: ISODate;
  users: UserDayRow[];
}

export interface UserWeekRow {
  userId: UserId;
  displayName?: string;
  onlineMinutes: number; // summed across the window
  voiceMinutes: number;
  ciSubmissions: number;
  engagementMessages: number;
  daysActive: number; // days with any tracked record
  perDay: { date: ISODate; onlineMinutes: number }[]; // for the TUI detail pane
}

export interface WeeklySummary {
  period: 'weekly';
  from: ISODate;
  to: ISODate;
  users: UserWeekRow[];
}

export type Summary = DailySummary | WeeklySummary;
