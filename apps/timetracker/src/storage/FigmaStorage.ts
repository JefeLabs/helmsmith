/**
 * The Figma storage port — a CAPABILITY interface alongside StorageAdapter,
 * not part of it. The Figma tracker requires it; the Discord bot never touches
 * it. SqliteAdapter implements both (same DB file — correlation queries and the
 * PRD's "one database" rule depend on that); DynamoAdapter doesn't yet, so
 * `figma start` fails fast on that backend instead of half-working.
 *
 * Figma→Discord member mapping intentionally reuses the existing identity_map
 * (provider 'figma') rather than adding a second mapping mechanism.
 */
import type {
  FigmaEvent,
  FigmaFile,
  FigmaMember,
  FigmaPresenceInterval,
} from '../figma/types.js';
import type { ISODate } from '../domain/types.js';
import type { StorageAdapter } from './StorageAdapter.js';

export interface FigmaStorage {
  // ── members ──────────────────────────────────────────────────────────
  upsertFigmaMember(figmaUserId: string, handle: string): Promise<void>;
  /** All known figma users with their Discord mapping (null = unmapped). */
  listFigmaMembers(): Promise<FigmaMember[]>;

  // ── files ────────────────────────────────────────────────────────────
  /** Insert or refresh name/project; preserves an existing `tracked` flag. */
  upsertFigmaFile(file: { fileKey: string; name?: string; project?: string }): Promise<void>;
  setFigmaFileTracked(fileKey: string, tracked: boolean): Promise<void>;
  listFigmaFiles(opts?: { trackedOnly?: boolean }): Promise<FigmaFile[]>;

  // ── events (append-only, deduped) ────────────────────────────────────
  /** Insert one event. Returns false when the dedupe key already exists. */
  insertFigmaEvent(event: FigmaEvent): Promise<boolean>;
  /** Events in the inclusive [from, to] day-key range, ordered by `at`. */
  listFigmaEventsRange(from: ISODate, to: ISODate): Promise<FigmaEvent[]>;

  // ── presence intervals (sentinel-measured) ───────────────────────────
  /** Open an interval; no-op if one is already open for (user, file). */
  openFigmaPresence(
    figmaUserId: string,
    fileKey: string,
    date: ISODate,
    startAt: string,
  ): Promise<void>;
  /** Close the open interval for (user, file); no-op when none is open. */
  closeFigmaPresence(figmaUserId: string, fileKey: string, endAt: string): Promise<void>;
  /** Force-close every open interval (dead sentinel — PRD §4.5). Returns count. */
  closeAllFigmaPresence(endAt: string): Promise<number>;
  listOpenFigmaPresence(): Promise<FigmaPresenceInterval[]>;
  /** Intervals whose day-key falls in the inclusive [from, to] range. */
  listFigmaPresenceRange(from: ISODate, to: ISODate): Promise<FigmaPresenceInterval[]>;
}

/** Narrow a StorageAdapter to one that also provides Figma storage. */
export function supportsFigma(s: StorageAdapter): s is StorageAdapter & FigmaStorage {
  return typeof (s as Partial<FigmaStorage>).insertFigmaEvent === 'function';
}
