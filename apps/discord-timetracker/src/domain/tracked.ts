/**
 * Tracked-set membership. When `trackedUserIds` is non-empty it is the
 * authoritative allowlist; an empty list means "no user-id restriction" (track
 * everyone, or defer to trackedRoleId in the poller). Pure so the poller,
 * message router, and reports all agree on who counts.
 */
import type { UserId } from './types.js';

export function isTracked(userId: UserId, trackedUserIds: readonly UserId[]): boolean {
  return trackedUserIds.length === 0 || trackedUserIds.includes(userId);
}
