/**
 * SQLite StorageAdapter — v1 default. Uses the runtime-portable driver shim
 * (bun:sqlite under Bun, node:sqlite under Node). Counters bump atomically via
 * `col = col + n` inside ON CONFLICT upserts, so concurrent gateway events in
 * the same window never lose updates.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqliteStorageConfig } from '../../config/schema.js';
import {
  type DailyActivity,
  type EndOfDay,
  emptyDay,
  type ISODate,
  type StartOfDay,
  type UserId,
} from '../../domain/types.js';
import type { StorageAdapter } from '../StorageAdapter.js';
import { openSqlite, type SqliteDb } from './driver.js';

const nowIso = () => new Date().toISOString();

export class SqliteAdapter implements StorageAdapter {
  private db!: SqliteDb;

  constructor(private readonly opts: SqliteStorageConfig) {}

  async init(): Promise<void> {
    if (this.opts.path !== ':memory:') {
      mkdirSync(dirname(this.opts.path), { recursive: true });
    }
    this.db = await openSqlite(this.opts.path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_activity (
        user_id          TEXT NOT NULL,
        date             TEXT NOT NULL,
        start_at         TEXT, start_msg_id TEXT, goals   TEXT,
        end_at           TEXT, end_msg_id   TEXT, summary TEXT,
        presence_samples INTEGER NOT NULL DEFAULT 0,
        presence_online  INTEGER NOT NULL DEFAULT 0,
        first_online_at  TEXT,
        last_online_at   TEXT,
        ci_submissions   INTEGER NOT NULL DEFAULT 0,
        engagement_msgs  INTEGER NOT NULL DEFAULT 0,
        voice_samples    INTEGER NOT NULL DEFAULT 0,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (user_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_activity(date);
      CREATE TABLE IF NOT EXISTS identity_map (
        provider    TEXT NOT NULL,
        external_id TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        PRIMARY KEY (provider, external_id)
      );
      CREATE TABLE IF NOT EXISTS users (
        user_id      TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        at         TEXT NOT NULL
      );
    `);
    // Bound the dedup table: a redelivery only ever follows shortly after the
    // original, so anything older than a week is safe to forget.
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.prepare('DELETE FROM processed_messages WHERE at < ?').run(cutoff);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async getDay(userId: UserId, date: ISODate): Promise<DailyActivity | null> {
    const row = this.db
      .prepare('SELECT * FROM daily_activity WHERE user_id = ? AND date = ?')
      .get(userId, date);
    return row ? rowToActivity(row) : null;
  }

  async upsertDay(a: DailyActivity): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO daily_activity (
           user_id, date, start_at, start_msg_id, goals, end_at, end_msg_id, summary,
           presence_samples, presence_online, first_online_at, last_online_at,
           ci_submissions, engagement_msgs, voice_samples, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           start_at=excluded.start_at, start_msg_id=excluded.start_msg_id, goals=excluded.goals,
           end_at=excluded.end_at, end_msg_id=excluded.end_msg_id, summary=excluded.summary,
           presence_samples=excluded.presence_samples, presence_online=excluded.presence_online,
           first_online_at=excluded.first_online_at, last_online_at=excluded.last_online_at,
           ci_submissions=excluded.ci_submissions, engagement_msgs=excluded.engagement_msgs,
           voice_samples=excluded.voice_samples, updated_at=excluded.updated_at`,
      )
      .run(
        a.userId,
        a.date,
        a.startOfDay?.at ?? null,
        a.startOfDay?.messageId ?? null,
        a.startOfDay?.goals ?? null,
        a.endOfDay?.at ?? null,
        a.endOfDay?.messageId ?? null,
        a.endOfDay?.summary ?? null,
        a.presence.samples,
        a.presence.online,
        a.presence.firstOnlineAt ?? null,
        a.presence.lastOnlineAt ?? null,
        a.ciSubmissions,
        a.engagementMessages,
        a.engagementVoiceSamples,
        a.updatedAt,
      );
  }

  async incrementCi(userId: UserId, date: ISODate, by = 1): Promise<void> {
    this.bumpCounter('ci_submissions', userId, date, by);
  }

  async incrementEngagement(userId: UserId, date: ISODate, by = 1): Promise<void> {
    this.bumpCounter('engagement_msgs', userId, date, by);
  }

  async incrementVoiceSamples(userId: UserId, date: ISODate, by = 1): Promise<void> {
    this.bumpCounter('voice_samples', userId, date, by);
  }

  /** Shared atomic upsert for the plain counters. Column name is a fixed literal. */
  private bumpCounter(
    column: 'ci_submissions' | 'engagement_msgs' | 'voice_samples',
    userId: UserId,
    date: ISODate,
    by: number,
  ): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO daily_activity (user_id, date, ${column}, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           ${column} = ${column} + ?, updated_at = ?`,
      )
      .run(userId, date, by, now, by, now);
  }

  async recordPresenceSample(
    userId: UserId,
    date: ISODate,
    online: boolean,
    at: string,
  ): Promise<void> {
    const onlineInt = online ? 1 : 0;
    const onlineAt = online ? at : null; // null leaves timestamps untouched via COALESCE
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO daily_activity
           (user_id, date, presence_samples, presence_online, first_online_at, last_online_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           presence_samples = presence_samples + 1,
           presence_online  = presence_online + ?,
           first_online_at  = COALESCE(first_online_at, ?),
           last_online_at   = COALESCE(?, last_online_at),
           updated_at       = ?`,
      )
      .run(userId, date, onlineInt, onlineAt, onlineAt, now, onlineInt, onlineAt, onlineAt, now);
  }

  async setStartOfDay(userId: UserId, date: ISODate, v: StartOfDay): Promise<void> {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO daily_activity (user_id, date, start_at, start_msg_id, goals, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           start_at = ?, start_msg_id = ?, goals = ?, updated_at = ?`,
      )
      .run(userId, date, v.at, v.messageId, v.goals, now, v.at, v.messageId, v.goals, now);
  }

  async setEndOfDay(userId: UserId, date: ISODate, v: EndOfDay): Promise<void> {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO daily_activity (user_id, date, end_at, end_msg_id, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           end_at = ?, end_msg_id = ?, summary = ?, updated_at = ?`,
      )
      .run(userId, date, v.at, v.messageId, v.summary, now, v.at, v.messageId, v.summary, now);
  }

  async listDay(date: ISODate): Promise<DailyActivity[]> {
    return this.db
      .prepare('SELECT * FROM daily_activity WHERE date = ? ORDER BY user_id')
      .all(date)
      .map(rowToActivity);
  }

  async listRange(from: ISODate, to: ISODate): Promise<DailyActivity[]> {
    return this.db
      .prepare('SELECT * FROM daily_activity WHERE date >= ? AND date <= ? ORDER BY date, user_id')
      .all(from, to)
      .map(rowToActivity);
  }

  async linkIdentity(provider: string, externalId: string, userId: UserId): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO identity_map (provider, external_id, user_id) VALUES (?, ?, ?)
         ON CONFLICT(provider, external_id) DO UPDATE SET user_id = ?`,
      )
      .run(provider, externalId, userId, userId);
  }

  async resolveIdentity(provider: string, externalId: string): Promise<UserId | null> {
    const row = this.db
      .prepare('SELECT user_id FROM identity_map WHERE provider = ? AND external_id = ?')
      .get(provider, externalId);
    return row ? (row.user_id as string) : null;
  }

  async listIdentities(provider: string): Promise<Array<{ externalId: string; userId: UserId }>> {
    return this.db
      .prepare(
        'SELECT external_id, user_id FROM identity_map WHERE provider = ? ORDER BY external_id',
      )
      .all(provider)
      .map((r) => ({ externalId: r.external_id as string, userId: r.user_id as string }));
  }

  async setUserName(userId: UserId, displayName: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO users (user_id, display_name, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET display_name = ?, updated_at = ?`,
      )
      .run(userId, displayName, nowIso(), displayName, nowIso());
  }

  async getUserNames(): Promise<Record<UserId, string>> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare('SELECT user_id, display_name FROM users').all()) {
      out[r.user_id as string] = r.display_name as string;
    }
    return out;
  }

  async getMeta(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? (row.value as string) : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
      )
      .run(key, value, value);
  }

  async markProcessed(messageId: string): Promise<boolean> {
    // Single-process bun:sqlite is synchronous, so select-then-insert is safe.
    if (this.db.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?').get(messageId)) {
      return false;
    }
    this.db
      .prepare('INSERT INTO processed_messages (message_id, at) VALUES (?, ?)')
      .run(messageId, nowIso());
    return true;
  }
}

/** Map a flat DB row back into the nested DailyActivity shape. */
function rowToActivity(r: Record<string, unknown>): DailyActivity {
  const a = emptyDay(r.user_id as string, r.date as string, r.updated_at as string);
  a.presence = {
    samples: Number(r.presence_samples ?? 0),
    online: Number(r.presence_online ?? 0),
    firstOnlineAt: (r.first_online_at as string) ?? undefined,
    lastOnlineAt: (r.last_online_at as string) ?? undefined,
  };
  a.ciSubmissions = Number(r.ci_submissions ?? 0);
  a.engagementMessages = Number(r.engagement_msgs ?? 0);
  a.engagementVoiceSamples = Number(r.voice_samples ?? 0);
  if (r.start_at) {
    a.startOfDay = {
      at: r.start_at as string,
      messageId: r.start_msg_id as string,
      goals: (r.goals as string) ?? '',
    };
  }
  if (r.end_at) {
    a.endOfDay = {
      at: r.end_at as string,
      messageId: r.end_msg_id as string,
      summary: (r.summary as string) ?? '',
    };
  }
  return a;
}
