/**
 * Event normalization: Figma's three source shapes (webhook deliveries,
 * polled versions, polled comments) → the one canonical FigmaEvent row.
 *
 * The externalId choices here ARE the dedupe strategy: a version carries its
 * version id whether it arrives by webhook or poll, so both paths collapse to
 * one row. Webhook-only types with no natural id (file_update, publish,
 * delete) synthesise `<fileKey>:<timestamp>` — a redelivery of the same
 * debounced event dedupes, while distinct debounce windows stay distinct.
 */
import { dayKeyFor } from '../domain/dayKey.js';
import type { FigmaComment, FigmaVersion } from './api.js';
import type { FigmaEvent } from './types.js';

/** Common webhook delivery fields (v2). Event-specific fields stay unknown. */
export interface FigmaWebhookPayload {
  event_type?: string;
  passcode?: string;
  timestamp?: string;
  file_key?: string;
  file_name?: string;
  triggered_by?: { id: string; handle: string };
  version_id?: string;
  comment_id?: string;
  [key: string]: unknown;
}

/** A normalized webhook: the event plus file/member facts worth upserting. */
export interface NormalizedWebhook {
  /** Null for deliveries that aren't activity (e.g. PING). */
  event: FigmaEvent | null;
  file?: { fileKey: string; name?: string };
  member?: { figmaUserId: string; handle: string };
}

export function versionEvent(fileKey: string, v: FigmaVersion, tz: string): FigmaEvent {
  return {
    eventType: 'version',
    fileKey,
    figmaUserId: v.user?.id ?? null,
    externalId: v.id,
    at: v.created_at,
    date: dayKeyFor(new Date(v.created_at), tz),
    source: 'poll',
    payload: JSON.stringify(v),
  };
}

export function commentEvent(fileKey: string, c: FigmaComment, tz: string): FigmaEvent {
  return {
    eventType: 'comment',
    fileKey,
    figmaUserId: c.user?.id ?? null,
    externalId: c.id,
    at: c.created_at,
    date: dayKeyFor(new Date(c.created_at), tz),
    source: 'poll',
    payload: JSON.stringify(c),
  };
}

const WEBHOOK_TYPE_MAP: Record<string, FigmaEvent['eventType']> = {
  FILE_UPDATE: 'file_update',
  FILE_VERSION_UPDATE: 'version',
  FILE_COMMENT: 'comment',
  LIBRARY_PUBLISH: 'library_publish',
  FILE_DELETE: 'file_delete',
};

/**
 * Normalize one webhook delivery. PING and unknown event types yield
 * `event: null` (acknowledged, not stored). The passcode must be verified by
 * the caller BEFORE this runs — normalization assumes an authentic delivery.
 */
export function webhookEvent(payload: FigmaWebhookPayload, tz: string): NormalizedWebhook {
  const eventType = WEBHOOK_TYPE_MAP[payload.event_type ?? ''];
  const fileKey = payload.file_key;
  if (!eventType || !fileKey) return { event: null };

  const at = payload.timestamp ?? new Date().toISOString();
  const user = payload.triggered_by;
  // Natural ids where the payload has them; synthesised otherwise.
  const externalId =
    eventType === 'version' && payload.version_id
      ? payload.version_id
      : eventType === 'comment' && payload.comment_id
        ? payload.comment_id
        : `${fileKey}:${at}`;

  return {
    event: {
      eventType,
      fileKey,
      figmaUserId: user?.id ?? null,
      externalId,
      at,
      date: dayKeyFor(new Date(at), tz),
      source: 'webhook',
      payload: JSON.stringify(payload),
    },
    file: { fileKey, name: payload.file_name },
    member: user ? { figmaUserId: user.id, handle: user.handle } : undefined,
  };
}
