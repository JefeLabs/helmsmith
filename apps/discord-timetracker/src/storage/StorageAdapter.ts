/**
 * The storage port. Every feature/UI module depends on THIS interface, never
 * on a concrete backend. A factory (factory.ts) injects SqliteAdapter or
 * DynamoAdapter based on config. See .plan/03-storage.md.
 *
 * Counter mutations are explicit (incrementCi, recordPresenceSample, …) rather
 * than only a full `upsertDay`, so each adapter can bump atomically — SQLite
 * via `col = col + n`, DynamoDB via `ADD` — and gateway event bursts in the
 * same window never lose updates.
 */
import type { DailyActivity, EndOfDay, ISODate, StartOfDay, UserId } from '../domain/types.js';

/** A present member's status at a poll tick. Offline members aren't recorded. */
export type PresenceState = 'active' | 'idle';

export interface StorageAdapter {
  /** Create tables / verify the backing store is reachable. */
  init(): Promise<void>;
  close(): Promise<void>;

  // ── daily activity ───────────────────────────────────────────────────
  getDay(userId: UserId, date: ISODate): Promise<DailyActivity | null>;
  upsertDay(activity: DailyActivity): Promise<void>;

  incrementCi(userId: UserId, date: ISODate, by?: number): Promise<void>;
  /** Text-message engagement in a tracked voice channel's chat. */
  incrementEngagement(userId: UserId, date: ISODate, by?: number): Promise<void>;
  /** One 5-min tick a user was connected to a tracked voice channel. */
  incrementVoiceSamples(userId: UserId, date: ISODate, by?: number): Promise<void>;
  /** Record one presence tick for a present member; `at` is its ISO timestamp. */
  recordPresenceSample(
    userId: UserId,
    date: ISODate,
    state: PresenceState,
    at: string,
  ): Promise<void>;
  setStartOfDay(userId: UserId, date: ISODate, value: StartOfDay): Promise<void>;
  setEndOfDay(userId: UserId, date: ISODate, value: EndOfDay): Promise<void>;

  // ── reporting reads (ReportService → Discord + TUI) ──────────────────
  listDay(date: ISODate): Promise<DailyActivity[]>;
  /** Inclusive [from, to] day-key range. */
  listRange(from: ISODate, to: ISODate): Promise<DailyActivity[]>;

  // ── display names (so reports show names, not snowflakes) ────────────
  setUserName(userId: UserId, displayName: string): Promise<void>;
  /** All known userId → displayName mappings. */
  getUserNames(): Promise<Record<UserId, string>>;

  // ── identity mapping (CI attribution) ────────────────────────────────
  linkIdentity(provider: string, externalId: string, userId: UserId): Promise<void>;
  resolveIdentity(provider: string, externalId: string): Promise<UserId | null>;
  /** All external→user mappings for a provider (e.g. to list github links). */
  listIdentities(provider: string): Promise<Array<{ externalId: string; userId: UserId }>>;

  // ── small key/value store (e.g. scheduler last-run markers) ──────────
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;

  /**
   * Claim a message id for processing. Returns true the first time (proceed),
   * false if already claimed (a gateway redelivery — skip). Makes the additive
   * handlers (CI, engagement) idempotent across reconnects.
   */
  markProcessed(messageId: string): Promise<boolean>;
}
