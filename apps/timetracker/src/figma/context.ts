/**
 * Shared context for the figma tracker's moving parts (webhook server,
 * poller, presence watchdog). The PRD's `state.json` IPC is replaced by the
 * storage `meta` table — the dashboard process reads the same keys instead of
 * a shared file, which the storage port already knows how to do.
 */
import type { FigmaConfig } from '../config/schema.js';
import type { FigmaStorage } from '../storage/FigmaStorage.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';

/** Meta keys the tracker writes and the reports/TUI read. */
export const FIGMA_META = {
  /** ISO ts of the newest ingested event (webhook or poll). */
  lastEventAt: 'figma:last_event_at',
  /** ISO ts of the last completed poll sweep. */
  lastPollAt: 'figma:last_poll_at',
  /** ISO ts of the last accepted sentinel snapshot — staleness anchor (§4.5). */
  presenceHeartbeat: 'figma:presence_heartbeat',
} as const;

export interface FigmaDeps {
  storage: StorageAdapter & FigmaStorage;
  figma: FigmaConfig;
  timezone: string;
}
