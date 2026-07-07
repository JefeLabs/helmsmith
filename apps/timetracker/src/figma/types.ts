/**
 * Figma-tracking domain types (see .plan/figma-tracker-prd.md). Two kinds of
 * signal, deliberately kept distinct end-to-end:
 *
 *  - EVENTS (versions, comments, publishes…) are coarse and debounced; work
 *    sessions derived from them ("bursts") are ESTIMATES and are always
 *    labeled as such in every UI.
 *  - PRESENCE intervals come from the sentinel plugin polling
 *    `figma.activeUsers` and are MEASURED (±poll interval) — but exist only
 *    for monitored files.
 *
 * Timestamps are ISO strings and each row carries a local `date` day-key,
 * matching the daily_activity conventions.
 */
import type { ISODate, UserId } from '../domain/types.js';

export type FigmaEventType =
  | 'file_update'
  | 'version'
  | 'comment'
  | 'library_publish'
  | 'file_delete';

export type FigmaEventSource = 'webhook' | 'poll';

export interface FigmaEvent {
  eventType: FigmaEventType;
  fileKey: string;
  /** Null when the source doesn't attribute a user (e.g. FILE_UPDATE webhooks). */
  figmaUserId: string | null;
  /**
   * Natural id from the source — version id, comment id, or `<fileKey>:<ts>`
   * for un-id'd webhook types. (event_type, file_key, external_id) is the
   * dedupe key, so the same version seen via webhook AND poll inserts once.
   */
  externalId: string;
  at: string; // ISO timestamp of the event
  date: ISODate; // local day-key of `at` in the configured tz
  source: FigmaEventSource;
  /** Raw source JSON, kept for audit/replay. */
  payload?: string;
}

export interface FigmaMember {
  figmaUserId: string;
  handle: string;
  /** Discord user, resolved via identity_map (provider 'figma'); null = unmapped. */
  discordUserId: UserId | null;
}

export interface FigmaFile {
  fileKey: string;
  name?: string;
  project?: string;
  /** Untracked files are kept for history but skipped by the poller. */
  tracked: boolean;
}

/** A measured in-file presence interval from the sentinel plugin (§4.5). */
export interface FigmaPresenceInterval {
  id: number;
  figmaUserId: string;
  fileKey: string;
  date: ISODate; // local day-key of startAt
  startAt: string;
  /** Null while the interval is open (user currently in the file). */
  endAt: string | null;
}

/** An inferred work burst — DERIVED from events at read time, never stored. */
export interface FigmaBurst {
  figmaUserId: string;
  startAt: string; // first event − pad (webhook debounce fires after work starts)
  endAt: string; // last event
  eventCount: number;
  estMinutes: number; // always presented with the ~/est. marker
  /** True when the burst overlaps the member's open Discord day-session. */
  inSession: boolean;
}
