/**
 * Shared StorageAdapter contract. The SAME suite runs against every adapter —
 * this is the real guarantee that swapping SQLite ↔ DynamoDB is safe (M2). A
 * test helper, not a spec file: it's imported by each adapter's *.test.ts and
 * is never reachable from the build entrypoints.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDay } from '../domain/types.js';
import type { StorageAdapter } from './StorageAdapter.js';

// BigInt, not number: 1e17 + n exceeds Number.MAX_SAFE_INTEGER, which would
// round adjacent ids to the SAME float. Snowflakes are 18-digit strings anyway.
const U = (n: number) => `${100000000000000000n + BigInt(n)}`;
const DAY = '2026-06-08';

export function storageContract(label: string, makeAdapter: () => Promise<StorageAdapter>): void {
  describe(`StorageAdapter contract: ${label}`, () => {
    let store: StorageAdapter;
    beforeEach(async () => {
      store = await makeAdapter();
    });
    afterEach(async () => {
      await store.close();
    });

    it('returns null for an unknown day', async () => {
      expect(await store.getDay(U(1), DAY)).toBeNull();
    });

    it('increments CI atomically with no lost updates under concurrency', async () => {
      await Promise.all(Array.from({ length: 25 }, () => store.incrementCi(U(2), DAY)));
      const day = await store.getDay(U(2), DAY);
      expect(day?.ciSubmissions).toBe(25);
    });

    it('counts text engagement and voice samples independently', async () => {
      await store.incrementEngagement(U(3), DAY);
      await store.incrementEngagement(U(3), DAY, 4);
      await store.incrementVoiceSamples(U(3), DAY, 6); // 6 ticks ≈ 30 min
      const day = await store.getDay(U(3), DAY);
      expect(day?.engagementMessages).toBe(5);
      expect(day?.engagementVoiceSamples).toBe(6);
    });

    it('aggregates presence, splitting active vs idle, tracks first/last seen', async () => {
      await store.recordPresenceSample(U(4), DAY, 'active', '2026-06-08T09:00:00Z');
      await store.recordPresenceSample(U(4), DAY, 'idle', '2026-06-08T09:05:00Z');
      await store.recordPresenceSample(U(4), DAY, 'active', '2026-06-08T17:00:00Z');
      const day = await store.getDay(U(4), DAY);
      expect(day?.presence.samples).toBe(3);
      expect(day?.presence.online).toBe(2); // active ticks
      expect(day?.presence.idle).toBe(1); // idle ticks
      expect(day?.presence.firstOnlineAt).toBe('2026-06-08T09:00:00Z');
      expect(day?.presence.lastOnlineAt).toBe('2026-06-08T17:00:00Z'); // last seen present
    });

    it('sets start and end of day', async () => {
      await store.setStartOfDay(U(5), DAY, {
        at: '2026-06-08T08:00:00Z',
        messageId: 'm1',
        goals: 'ship M2',
      });
      await store.setEndOfDay(U(5), DAY, {
        at: '2026-06-08T18:00:00Z',
        messageId: 'm2',
        summary: 'M2 shipped',
      });
      const day = await store.getDay(U(5), DAY);
      expect(day?.startOfDay?.goals).toBe('ship M2');
      expect(day?.endOfDay?.summary).toBe('M2 shipped');
    });

    it('upserts a full day and reads it back', async () => {
      const a = emptyDay(U(6), DAY, '2026-06-08T00:00:00Z');
      a.ciSubmissions = 3;
      a.presence = {
        samples: 10,
        online: 8,
        idle: 2,
        firstOnlineAt: '2026-06-08T09:00:00Z',
        lastOnlineAt: '2026-06-08T17:00:00Z',
      };
      await store.upsertDay(a);
      const got = await store.getDay(U(6), DAY);
      expect(got?.ciSubmissions).toBe(3);
      expect(got?.presence.online).toBe(8);
      expect(got?.presence.idle).toBe(2);
    });

    it('lists a day and an inclusive range', async () => {
      await store.incrementCi(U(7), '2026-06-08');
      await store.incrementCi(U(8), '2026-06-08');
      await store.incrementCi(U(7), '2026-06-10');

      const day = await store.listDay('2026-06-08');
      expect(day.map((d) => d.userId).sort()).toEqual([U(7), U(8)].sort());

      const range = await store.listRange('2026-06-08', '2026-06-10');
      expect(range.length).toBe(3); // U7/08, U8/08, U7/10
    });

    it('marks a message processed exactly once (idempotency guard)', async () => {
      expect(await store.markProcessed('msg-1')).toBe(true); // first claim
      expect(await store.markProcessed('msg-1')).toBe(false); // redelivery → skip
      expect(await store.markProcessed('msg-2')).toBe(true); // a different message
    });

    it('stores and reads meta key/values, overwriting on re-set', async () => {
      expect(await store.getMeta('scheduler')).toBeNull();
      await store.setMeta('scheduler', '{"lastDailyRunDay":"2026-06-08"}');
      expect(await store.getMeta('scheduler')).toBe('{"lastDailyRunDay":"2026-06-08"}');
      await store.setMeta('scheduler', 'updated');
      expect(await store.getMeta('scheduler')).toBe('updated');
    });

    it('links and resolves an identity, and overwrites on relink', async () => {
      await store.linkIdentity('github', 'octocat', U(9));
      expect(await store.resolveIdentity('github', 'octocat')).toBe(U(9));
      await store.linkIdentity('github', 'octocat', U(10));
      expect(await store.resolveIdentity('github', 'octocat')).toBe(U(10));
      expect(await store.resolveIdentity('github', 'nobody')).toBeNull();
    });

    it('lists all identities for a provider', async () => {
      await store.linkIdentity('github', 'octocat', U(9));
      await store.linkIdentity('github', 'hubot', U(10));
      const links = await store.listIdentities('github');
      expect(links).toHaveLength(2);
      expect(links.find((l) => l.externalId === 'octocat')?.userId).toBe(U(9));
      expect(await store.listIdentities('gitlab')).toEqual([]);
    });

    it('stores and reads display names', async () => {
      expect(await store.getUserNames()).toEqual({});
      await store.setUserName(U(11), 'Yelisson');
      await store.setUserName(U(12), 'Edwin');
      await store.setUserName(U(11), 'Yelisson Ortiz'); // rename
      const names = await store.getUserNames();
      expect(names[U(11)]).toBe('Yelisson Ortiz');
      expect(names[U(12)]).toBe('Edwin');
    });
  });
}
