/**
 * Shared FigmaStorage contract — mirrors contract.ts. Today only SqliteAdapter
 * implements the port; when the DynamoDB adapter grows Figma support, running
 * this same suite against it is the migration guarantee.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FigmaEvent } from '../figma/types.js';
import type { FigmaStorage } from './FigmaStorage.js';
import type { StorageAdapter } from './StorageAdapter.js';

const DAY = '2026-07-06';

function event(over: Partial<FigmaEvent> = {}): FigmaEvent {
  return {
    eventType: 'version',
    fileKey: 'fileA',
    figmaUserId: 'u1',
    externalId: 'v100',
    at: `${DAY}T14:00:00.000Z`,
    date: DAY,
    source: 'poll',
    ...over,
  };
}

export function figmaStorageContract(
  label: string,
  makeAdapter: () => Promise<StorageAdapter & FigmaStorage>,
): void {
  describe(`FigmaStorage contract: ${label}`, () => {
    let store: StorageAdapter & FigmaStorage;
    beforeEach(async () => {
      store = await makeAdapter();
    });
    afterEach(async () => {
      await store.close();
    });

    it('dedupes events on (type, file, externalId) across sources', async () => {
      expect(await store.insertFigmaEvent(event({ source: 'webhook' }))).toBe(true);
      // Same version arriving later via the backfill poll must not double-count.
      expect(await store.insertFigmaEvent(event({ source: 'poll' }))).toBe(false);
      // …but the same external id on a DIFFERENT type or file is a new event.
      expect(await store.insertFigmaEvent(event({ eventType: 'comment' }))).toBe(true);
      expect(await store.insertFigmaEvent(event({ fileKey: 'fileB' }))).toBe(true);
      expect(await store.listFigmaEventsRange(DAY, DAY)).toHaveLength(3);
    });

    it('lists events by day-key range ordered by timestamp', async () => {
      await store.insertFigmaEvent(
        event({ externalId: 'v2', at: `${DAY}T15:00:00.000Z` }),
      );
      await store.insertFigmaEvent(event({ externalId: 'v1', at: `${DAY}T09:00:00.000Z` }));
      await store.insertFigmaEvent(
        event({ externalId: 'v0', at: '2026-07-01T09:00:00.000Z', date: '2026-07-01' }),
      );
      const events = await store.listFigmaEventsRange(DAY, DAY);
      expect(events.map((e) => e.externalId)).toEqual(['v1', 'v2']);
      const all = await store.listFigmaEventsRange('2026-07-01', DAY);
      expect(all).toHaveLength(3);
    });

    it('keeps events with no user attribution (unmapped is data, not an error)', async () => {
      await store.insertFigmaEvent(event({ eventType: 'file_update', figmaUserId: null }));
      const [e] = await store.listFigmaEventsRange(DAY, DAY);
      expect(e.figmaUserId).toBeNull();
    });

    it('upserts files, preserving project and tracked flag across partial updates', async () => {
      await store.upsertFigmaFile({ fileKey: 'fileA', name: 'design-system', project: 'Core' });
      await store.setFigmaFileTracked('fileA', false);
      // A webhook-driven upsert knows the name but not the project.
      await store.upsertFigmaFile({ fileKey: 'fileA', name: 'design-system v2' });
      const [f] = await store.listFigmaFiles();
      expect(f).toMatchObject({
        fileKey: 'fileA',
        name: 'design-system v2',
        project: 'Core',
        tracked: false,
      });
      expect(await store.listFigmaFiles({ trackedOnly: true })).toHaveLength(0);
    });

    it('maps members to Discord users via identity_map (provider figma)', async () => {
      await store.upsertFigmaMember('u1', 'ana');
      await store.upsertFigmaMember('u2', 'marco');
      await store.linkIdentity('figma', 'u1', '123456789012345678');
      const members = await store.listFigmaMembers();
      expect(members).toEqual([
        { figmaUserId: 'u1', handle: 'ana', discordUserId: '123456789012345678' },
        { figmaUserId: 'u2', handle: 'marco', discordUserId: null },
      ]);
    });

    it('opens presence idempotently and closes only the open interval', async () => {
      await store.openFigmaPresence('u1', 'fileA', DAY, `${DAY}T10:00:00.000Z`);
      // A later snapshot with the user still present must not restart the interval.
      await store.openFigmaPresence('u1', 'fileA', DAY, `${DAY}T10:01:00.000Z`);
      expect(await store.listOpenFigmaPresence()).toHaveLength(1);

      await store.closeFigmaPresence('u1', 'fileA', `${DAY}T10:30:00.000Z`);
      expect(await store.listOpenFigmaPresence()).toHaveLength(0);
      const [iv] = await store.listFigmaPresenceRange(DAY, DAY);
      expect(iv.startAt).toBe(`${DAY}T10:00:00.000Z`);
      expect(iv.endAt).toBe(`${DAY}T10:30:00.000Z`);
    });

    it('force-closes every open interval when the sentinel dies', async () => {
      await store.openFigmaPresence('u1', 'fileA', DAY, `${DAY}T10:00:00.000Z`);
      await store.openFigmaPresence('u2', 'fileA', DAY, `${DAY}T10:05:00.000Z`);
      const closed = await store.closeAllFigmaPresence(`${DAY}T10:10:00.000Z`);
      expect(closed).toBe(2);
      expect(await store.listOpenFigmaPresence()).toHaveLength(0);
      // Closing again is a no-op — a stale sentinel must never inflate time.
      expect(await store.closeAllFigmaPresence(`${DAY}T11:00:00.000Z`)).toBe(0);
    });
  });
}
