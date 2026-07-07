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
import type {
  FigmaEvent,
  FigmaEventSource,
  FigmaEventType,
  FigmaFile,
  FigmaMember,
  FigmaPresenceInterval,
} from '../../figma/types.js';
import type { FigmaStorage } from '../FigmaStorage.js';
import type { PresenceState, StorageAdapter } from '../StorageAdapter.js';
import { openSqlite, type SqliteDb } from './driver.js';

const nowIso = () => new Date().toISOString();

export class SqliteAdapter implements StorageAdapter, FigmaStorage {
  private db!: SqliteDb;
  private txDepth = 0;

  constructor(private readonly opts: SqliteStorageConfig) {}

  /**
   * Atomic unit of work. On success the whole `fn` commits; if it throws, the
   * transaction rolls back. A hard process kill before COMMIT is rolled back by
   * SQLite's own crash recovery on next open. Nested calls join the outer
   * transaction (single-connection, single-process), so this is reentrant-safe.
   *
   * Safe because every handler `fn` only touches this synchronous SQLite
   * connection — no real async I/O yields the event loop mid-transaction, so no
   * other writer can interleave between BEGIN and COMMIT.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.txDepth > 0) return fn(); // already inside a transaction — join it
    this.db.exec('BEGIN');
    this.txDepth++;
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth--;
    }
  }

  async init(): Promise<void> {
    if (this.opts.path !== ':memory:') {
      mkdirSync(dirname(this.opts.path), { recursive: true });
    }
    this.db = await openSqlite(this.opts.path);
    // Two processes write this file (the Discord bot and the Figma tracker).
    // WAL lets a reader/writer pair coexist; busy_timeout makes the rare
    // writer/writer collision wait instead of throwing SQLITE_BUSY. No-op for
    // :memory: databases.
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_activity (
        user_id          TEXT NOT NULL,
        date             TEXT NOT NULL,
        start_at         TEXT, start_msg_id TEXT, goals   TEXT,
        end_at           TEXT, end_msg_id   TEXT, summary TEXT,
        presence_samples INTEGER NOT NULL DEFAULT 0,
        presence_online  INTEGER NOT NULL DEFAULT 0,
        presence_idle    INTEGER NOT NULL DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS figma_members (
        figma_user_id TEXT PRIMARY KEY,
        handle        TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS figma_files (
        file_key   TEXT PRIMARY KEY,
        name       TEXT,
        project    TEXT,
        tracked    INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS figma_events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type    TEXT NOT NULL,
        file_key      TEXT NOT NULL,
        figma_user_id TEXT,
        external_id   TEXT NOT NULL,
        at            TEXT NOT NULL,
        date          TEXT NOT NULL,
        source        TEXT NOT NULL,
        payload       TEXT,
        UNIQUE(event_type, file_key, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_figma_events_date ON figma_events(date);
      CREATE TABLE IF NOT EXISTS figma_presence (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        figma_user_id TEXT NOT NULL,
        file_key      TEXT NOT NULL,
        date          TEXT NOT NULL,
        start_at      TEXT NOT NULL,
        end_at        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_figma_presence_date ON figma_presence(date);
      CREATE INDEX IF NOT EXISTS idx_figma_presence_open
        ON figma_presence(figma_user_id, file_key) WHERE end_at IS NULL;
    `);
    // Migration: add presence_idle to DBs created before idle tracking. The
    // CREATE above covers fresh DBs; this ALTER covers existing ones (and is a
    // harmless no-op error on fresh ones, hence the swallow).
    try {
      this.db.exec('ALTER TABLE daily_activity ADD COLUMN presence_idle INTEGER NOT NULL DEFAULT 0');
    } catch {
      // column already exists — nothing to do
    }

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
           presence_samples, presence_online, presence_idle, first_online_at, last_online_at,
           ci_submissions, engagement_msgs, voice_samples, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           start_at=excluded.start_at, start_msg_id=excluded.start_msg_id, goals=excluded.goals,
           end_at=excluded.end_at, end_msg_id=excluded.end_msg_id, summary=excluded.summary,
           presence_samples=excluded.presence_samples, presence_online=excluded.presence_online,
           presence_idle=excluded.presence_idle,
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
        a.presence.idle,
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
    state: PresenceState,
    at: string,
  ): Promise<void> {
    // A present member is either active (online/dnd) or idle; both advance the
    // first/last-seen timestamps that bound the "span". Offline members aren't
    // recorded at all (the poller skips them), so every call counts as a sample.
    const activeInt = state === 'active' ? 1 : 0;
    const idleInt = state === 'idle' ? 1 : 0;
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO daily_activity
           (user_id, date, presence_samples, presence_online, presence_idle, first_online_at, last_online_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET
           presence_samples = presence_samples + 1,
           presence_online  = presence_online + ?,
           presence_idle    = presence_idle + ?,
           first_online_at  = COALESCE(first_online_at, ?),
           last_online_at   = ?,
           updated_at       = ?`,
      )
      .run(userId, date, activeInt, idleInt, at, at, now, activeInt, idleInt, at, at, now);
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

  // ── FigmaStorage ───────────────────────────────────────────────────────

  async upsertFigmaMember(figmaUserId: string, handle: string): Promise<void> {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO figma_members (figma_user_id, handle, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(figma_user_id) DO UPDATE SET handle = ?, updated_at = ?`,
      )
      .run(figmaUserId, handle, now, handle, now);
  }

  async listFigmaMembers(): Promise<FigmaMember[]> {
    // Discord mapping lives in identity_map (provider 'figma') — same
    // mechanism as GitHub CI attribution, managed by `figma map-members`.
    return this.db
      .prepare(
        `SELECT m.figma_user_id, m.handle, i.user_id
           FROM figma_members m
           LEFT JOIN identity_map i ON i.provider = 'figma' AND i.external_id = m.figma_user_id
          ORDER BY m.handle`,
      )
      .all()
      .map((r) => ({
        figmaUserId: r.figma_user_id as string,
        handle: r.handle as string,
        discordUserId: (r.user_id as string) ?? null,
      }));
  }

  async upsertFigmaFile(file: { fileKey: string; name?: string; project?: string }): Promise<void> {
    const now = nowIso();
    // COALESCE(excluded.…, existing) so a webhook event (key + name only)
    // never wipes a project set by sync-files, and vice versa.
    this.db
      .prepare(
        `INSERT INTO figma_files (file_key, name, project, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(file_key) DO UPDATE SET
           name = COALESCE(excluded.name, figma_files.name),
           project = COALESCE(excluded.project, figma_files.project),
           updated_at = excluded.updated_at`,
      )
      .run(file.fileKey, file.name ?? null, file.project ?? null, now);
  }

  async setFigmaFileTracked(fileKey: string, tracked: boolean): Promise<void> {
    this.db
      .prepare('UPDATE figma_files SET tracked = ?, updated_at = ? WHERE file_key = ?')
      .run(tracked ? 1 : 0, nowIso(), fileKey);
  }

  async listFigmaFiles(opts?: { trackedOnly?: boolean }): Promise<FigmaFile[]> {
    const rows = opts?.trackedOnly
      ? this.db.prepare('SELECT * FROM figma_files WHERE tracked = 1 ORDER BY file_key').all()
      : this.db.prepare('SELECT * FROM figma_files ORDER BY file_key').all();
    return rows.map((r) => ({
      fileKey: r.file_key as string,
      name: (r.name as string) ?? undefined,
      project: (r.project as string) ?? undefined,
      tracked: Number(r.tracked) === 1,
    }));
  }

  async insertFigmaEvent(e: FigmaEvent): Promise<boolean> {
    // INSERT OR IGNORE + the UNIQUE(event_type, file_key, external_id) key is
    // the whole webhook/poll dedupe story: same version from both paths → one row.
    const before = this.db
      .prepare('SELECT 1 FROM figma_events WHERE event_type = ? AND file_key = ? AND external_id = ?')
      .get(e.eventType, e.fileKey, e.externalId);
    if (before) return false;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO figma_events
           (event_type, file_key, figma_user_id, external_id, at, date, source, payload)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        e.eventType,
        e.fileKey,
        e.figmaUserId,
        e.externalId,
        e.at,
        e.date,
        e.source,
        e.payload ?? null,
      );
    return true;
  }

  async listFigmaEventsRange(from: ISODate, to: ISODate): Promise<FigmaEvent[]> {
    return this.db
      .prepare('SELECT * FROM figma_events WHERE date >= ? AND date <= ? ORDER BY at, id')
      .all(from, to)
      .map(rowToFigmaEvent);
  }

  async openFigmaPresence(
    figmaUserId: string,
    fileKey: string,
    date: ISODate,
    startAt: string,
  ): Promise<void> {
    const open = this.db
      .prepare(
        'SELECT 1 FROM figma_presence WHERE figma_user_id = ? AND file_key = ? AND end_at IS NULL',
      )
      .get(figmaUserId, fileKey);
    if (open) return; // already in the file — keep the original start
    this.db
      .prepare(
        'INSERT INTO figma_presence (figma_user_id, file_key, date, start_at) VALUES (?,?,?,?)',
      )
      .run(figmaUserId, fileKey, date, startAt);
  }

  async closeFigmaPresence(figmaUserId: string, fileKey: string, endAt: string): Promise<void> {
    this.db
      .prepare(
        `UPDATE figma_presence SET end_at = ?
          WHERE figma_user_id = ? AND file_key = ? AND end_at IS NULL`,
      )
      .run(endAt, figmaUserId, fileKey);
  }

  async closeAllFigmaPresence(endAt: string): Promise<number> {
    const open = this.db
      .prepare('SELECT COUNT(*) AS n FROM figma_presence WHERE end_at IS NULL')
      .get();
    this.db.prepare('UPDATE figma_presence SET end_at = ? WHERE end_at IS NULL').run(endAt);
    return Number(open?.n ?? 0);
  }

  async listOpenFigmaPresence(): Promise<FigmaPresenceInterval[]> {
    return this.db
      .prepare('SELECT * FROM figma_presence WHERE end_at IS NULL ORDER BY start_at, id')
      .all()
      .map(rowToPresence);
  }

  async listFigmaPresenceRange(from: ISODate, to: ISODate): Promise<FigmaPresenceInterval[]> {
    return this.db
      .prepare('SELECT * FROM figma_presence WHERE date >= ? AND date <= ? ORDER BY start_at, id')
      .all(from, to)
      .map(rowToPresence);
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

function rowToFigmaEvent(r: Record<string, unknown>): FigmaEvent {
  return {
    eventType: r.event_type as FigmaEventType,
    fileKey: r.file_key as string,
    figmaUserId: (r.figma_user_id as string) ?? null,
    externalId: r.external_id as string,
    at: r.at as string,
    date: r.date as string,
    source: r.source as FigmaEventSource,
    payload: (r.payload as string) ?? undefined,
  };
}

function rowToPresence(r: Record<string, unknown>): FigmaPresenceInterval {
  return {
    id: Number(r.id),
    figmaUserId: r.figma_user_id as string,
    fileKey: r.file_key as string,
    date: r.date as string,
    startAt: r.start_at as string,
    endAt: (r.end_at as string) ?? null,
  };
}

/** Map a flat DB row back into the nested DailyActivity shape. */
function rowToActivity(r: Record<string, unknown>): DailyActivity {
  const a = emptyDay(r.user_id as string, r.date as string, r.updated_at as string);
  a.presence = {
    samples: Number(r.presence_samples ?? 0),
    online: Number(r.presence_online ?? 0),
    idle: Number(r.presence_idle ?? 0),
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
