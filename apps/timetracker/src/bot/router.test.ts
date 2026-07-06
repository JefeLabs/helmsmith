import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config/schema.js';
import { SqliteAdapter } from '../storage/sqlite/SqliteAdapter.js';
import type { IncomingMessage } from './message.js';
import { routeMessage } from './router.js';

const config = {
  token: 't',
  guildId: 'g',
  channels: { goals: 'GOALS', summary: 'SUMMARY', ci: 'CI' },
  voiceChannelIds: [],
  trackedUserIds: [],
  adminRoleId: 'A',
  reportChannelId: 'R',
  timezone: 'UTC',
  weekStartsOn: 'monday',
  schedule: { enabled: true, dailyAt: '09:00' },
  capture: { startOfDayFirstWins: true, endOfDayLastWins: true },
  storage: { backend: 'sqlite', path: ':memory:' },
} as Config;

const summaryMsg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  id: 'msg1',
  channelId: 'SUMMARY', // → handleEndOfDay
  authorId: 'U1',
  authorIsBot: false,
  authorName: 'User One',
  content: "Today's summary",
  createdAt: new Date('2026-06-08T17:00:00Z'),
  ...over,
});

describe('routeMessage atomic dedup', () => {
  let storage: SqliteAdapter;
  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
  });

  it('processes a tracked message once and claims it', async () => {
    await routeMessage(summaryMsg(), { storage, config });
    expect((await storage.getDay('U1', '2026-06-08'))?.endOfDay?.at).toBe(
      '2026-06-08T17:00:00.000Z',
    );
    expect(await storage.markProcessed('msg1')).toBe(false); // already claimed
  });

  it('rolls back the claim when the handler fails, so a replay recovers it', async () => {
    // First delivery: the write blows up mid-handler (mimics a crash/kill).
    const realSetEnd = storage.setEndOfDay.bind(storage);
    storage.setEndOfDay = async () => {
      throw new Error('write failed');
    };
    await expect(routeMessage(summaryMsg(), { storage, config })).rejects.toThrow('write failed');

    // Nothing was written, and crucially the claim rolled back too.
    expect(await storage.getDay('U1', '2026-06-08')).toBeNull();

    // Redelivery / backfill of the SAME id now succeeds — it was never stranded.
    storage.setEndOfDay = realSetEnd;
    await routeMessage(summaryMsg(), { storage, config });
    expect((await storage.getDay('U1', '2026-06-08'))?.endOfDay?.at).toBe(
      '2026-06-08T17:00:00.000Z',
    );
  });
});
