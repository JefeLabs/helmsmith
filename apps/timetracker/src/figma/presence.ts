/**
 * Sentinel presence derivation (PRD §4.5). The plugin POSTs a snapshot of
 * `figma.activeUsers` per monitored file every ~45s; this module turns those
 * snapshots into open/close interval decisions:
 *
 *   - user present, not currently open  → open an interval at snapshot ts
 *   - user absent from ONE snapshot     → tolerated (poll jitter)
 *   - user absent from TWO consecutive  → close at their LAST-SEEN ts
 *
 * Pure state machine over snapshots — storage writes happen in the tracker
 * service, which applies the returned decisions. One tracker per file key.
 */

export interface PresenceDecisions {
  /** Users to open an interval for, at the snapshot timestamp. */
  open: string[];
  /** Users to close, each at the timestamp they were last seen. */
  close: Array<{ userId: string; at: string }>;
}

interface SeenState {
  misses: number;
  lastSeenAt: string;
}

export class FilePresenceTracker {
  /** Users considered "in the file": open interval + miss counter. */
  private seen = new Map<string, SeenState>();

  constructor(
    /** Consecutive missed snapshots tolerated before closing (PRD: 1). */
    private readonly missTolerance = 1,
  ) {}

  /**
   * Apply one snapshot. `presentIds` should already exclude the sentinel's
   * own user id (it always appears in its own activeUsers).
   */
  apply(presentIds: ReadonlyArray<string>, ts: string): PresenceDecisions {
    const present = new Set(presentIds);
    const decisions: PresenceDecisions = { open: [], close: [] };

    for (const id of present) {
      const state = this.seen.get(id);
      if (state) {
        state.misses = 0;
        state.lastSeenAt = ts;
      } else {
        this.seen.set(id, { misses: 0, lastSeenAt: ts });
        decisions.open.push(id);
      }
    }

    for (const [id, state] of this.seen) {
      if (present.has(id)) continue;
      state.misses++;
      if (state.misses > this.missTolerance) {
        decisions.close.push({ userId: id, at: state.lastSeenAt });
        this.seen.delete(id);
      }
    }

    return decisions;
  }

  /**
   * Drop all in-memory state and report who was open, with their last-seen
   * ts — used when the sentinel goes stale and intervals must force-close.
   */
  reset(): Array<{ userId: string; at: string }> {
    const open = [...this.seen.entries()].map(([userId, s]) => ({
      userId,
      at: s.lastSeenAt,
    }));
    this.seen.clear();
    return open;
  }

  /** Users currently considered in-file (for the Presence Now panel). */
  openUsers(): string[] {
    return [...this.seen.keys()];
  }
}
