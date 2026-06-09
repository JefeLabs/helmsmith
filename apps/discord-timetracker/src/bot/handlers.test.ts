import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config/schema.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { SqliteAdapter } from '../storage/sqlite/SqliteAdapter.js';
import { type BotDeps, handleCiSubmission } from './handlers.js';
import type { IncomingMessage } from './message.js';
import { routeMessage } from './router.js';

const DAY = '2026-06-08';

function makeConfig(over: Partial<Config> = {}): Config {
  return {
    token: 't',
    guildId: 'g',
    channels: { goals: 'GOALS', summary: 'SUMMARY', ci: 'CI' },
    voiceChannelIds: ['VOICE1', 'VOICE2'],
    adminRoleId: 'A',
    reportChannelId: 'R',
    timezone: 'UTC',
    capture: { startOfDayFirstWins: true, endOfDayLastWins: true },
    storage: { backend: 'sqlite', path: ':memory:' },
    ...over,
  };
}

function msg(over: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    id: 'm1',
    channelId: 'GOALS',
    authorId: 'U1',
    authorIsBot: false,
    authorName: 'Tester',
    content: '',
    createdAt: new Date('2026-06-08T10:00:00Z'),
    ...over,
  };
}

// A real GitHub Monitor message: two run blocks (PR-create + push), same actor.
const CI_TWO_BLOCKS = [
  'Tests completed on create Pull Request: fix(core): SimpleSelect',
  'Project: skoolscout/skoolscout-com',
  'PR: fix/x --> develop',
  'PR Actor: yelisson-skoolscout',
  'PR Link: https://github.com/skoolscout/skoolscout-com/pull/2569',
  'Tests completed on push event on  develop.',
  'Project: skoolscout/skoolscout-com',
  'PR Actor: yelisson-skoolscout',
].join('\n');

const CI_SYSTEM = [
  'Tests completed on push event on  develop.',
  'Project: x',
  'PR Actor: Github System',
].join('\n');

describe('M3 handlers + router', () => {
  let storage: StorageAdapter;
  let deps: BotDeps;
  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    deps = { storage, config: makeConfig() };
  });

  it('start of day: first post wins, later posts do not overwrite', async () => {
    await routeMessage(msg({ channelId: 'GOALS', id: 'a', content: 'goal A' }), deps);
    await routeMessage(msg({ channelId: 'GOALS', id: 'b', content: 'goal B' }), deps);
    const day = await storage.getDay('U1', DAY);
    expect(day?.startOfDay?.goals).toBe('goal A');
    expect(day?.startOfDay?.messageId).toBe('a');
  });

  it('end of day: last post wins', async () => {
    await routeMessage(msg({ channelId: 'SUMMARY', id: 'a', content: 'sum A' }), deps);
    await routeMessage(msg({ channelId: 'SUMMARY', id: 'b', content: 'sum B' }), deps);
    expect((await storage.getDay('U1', DAY))?.endOfDay?.summary).toBe('sum B');
  });

  it('end of day: first wins when endOfDayLastWins=false', async () => {
    deps = {
      storage,
      config: makeConfig({ capture: { startOfDayFirstWins: true, endOfDayLastWins: false } }),
    };
    await routeMessage(msg({ channelId: 'SUMMARY', id: 'a', content: 'sum A' }), deps);
    await routeMessage(msg({ channelId: 'SUMMARY', id: 'b', content: 'sum B' }), deps);
    expect((await storage.getDay('U1', DAY))?.endOfDay?.summary).toBe('sum A');
  });

  it('text engagement: messages in tracked voice channels are counted', async () => {
    await routeMessage(msg({ id: 'e1', channelId: 'VOICE1' }), deps);
    await routeMessage(msg({ id: 'e2', channelId: 'VOICE2' }), deps);
    await routeMessage(msg({ id: 'e3', channelId: 'SOME_OTHER_CHANNEL' }), deps); // not tracked
    expect((await storage.getDay('U1', DAY))?.engagementMessages).toBe(2);
  });

  it('CI: counts every PR Actor block for a linked human, skips Github System', async () => {
    await storage.linkIdentity('github', 'yelisson-skoolscout', 'U9');
    await routeMessage(
      msg({ id: 'ci1', channelId: 'CI', authorIsBot: true, content: CI_TWO_BLOCKS }),
      deps,
    );
    await routeMessage(
      msg({ id: 'ci2', channelId: 'CI', authorIsBot: true, content: CI_SYSTEM }),
      deps,
    );
    expect((await storage.getDay('U9', DAY))?.ciSubmissions).toBe(2); // two blocks
    expect(await storage.listDay(DAY)).toHaveLength(1); // Github System created nothing
  });

  it('idempotency: a redelivered message id is not double-counted', async () => {
    await storage.linkIdentity('github', 'yelisson-skoolscout', 'U9');
    const dup = msg({ id: 'dup', channelId: 'CI', authorIsBot: true, content: CI_TWO_BLOCKS });
    await routeMessage(dup, deps);
    await routeMessage(dup, deps); // gateway redelivery — must be ignored
    expect((await storage.getDay('U9', DAY))?.ciSubmissions).toBe(2); // not 4
  });

  it('CI: an unlinked human actor is skipped (no mapping → no count)', async () => {
    const n = await handleCiSubmission(
      msg({ channelId: 'CI', authorIsBot: true, content: 'PR Actor: someone-new' }),
      deps,
    );
    expect(n).toBe(0);
  });

  it('captures the author display name on a human message', async () => {
    await routeMessage(msg({ channelId: 'GOALS', authorId: 'U1', authorName: 'Edwin Cruz' }), deps);
    expect(await storage.getUserNames()).toEqual({ U1: 'Edwin Cruz' });
  });

  it('bot guard: a bot posting in a non-CI channel is ignored', async () => {
    await routeMessage(
      msg({ channelId: 'GOALS', authorId: 'BOT', authorIsBot: true, content: 'x' }),
      deps,
    );
    expect(await storage.getDay('BOT', DAY)).toBeNull();
  });
});
