import { beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config/schema.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';
import { SqliteAdapter } from '../storage/sqlite/SqliteAdapter.js';
import type { BotDeps } from './handlers.js';
import { applyPoll, type MemberSnapshot } from './poller.js';

const DAY = '2026-06-08';
const NOW = new Date('2026-06-08T15:00:00Z');

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

const snap = (over: Partial<MemberSnapshot> & { userId: string }): MemberSnapshot => ({
  isBot: false,
  displayName: 'Member',
  presence: 'offline',
  voiceChannelId: null,
  ...over,
});

describe('M4 applyPoll', () => {
  let storage: StorageAdapter;
  let deps: BotDeps;
  beforeEach(async () => {
    storage = new SqliteAdapter({ backend: 'sqlite', path: ':memory:' });
    await storage.init();
    deps = { storage, config: makeConfig() };
  });

  it('samples presence for online members and voice for tracked-channel members', async () => {
    const members: MemberSnapshot[] = [
      snap({ userId: 'U1', presence: 'active', voiceChannelId: 'VOICE1' }), // presence + voice
      snap({ userId: 'U2', presence: 'offline', voiceChannelId: 'VOICE1' }), // voice only (offline)
      snap({ userId: 'U3', presence: 'active', voiceChannelId: null }), // presence only
      snap({ userId: 'U4', presence: 'active', voiceChannelId: 'OTHER' }), // presence only (untracked voice)
      snap({ userId: 'BOT', presence: 'active', voiceChannelId: 'VOICE1', isBot: true }), // ignored
    ];
    const counts = await applyPoll(members, deps, NOW);
    expect(counts).toEqual({ presence: 3, voice: 2 }); // U1,U3,U4 online; U1,U2 voice

    const u1 = await storage.getDay('U1', DAY);
    expect(u1?.presence.online).toBe(1);
    expect(u1?.engagementVoiceSamples).toBe(1);

    const u2 = await storage.getDay('U2', DAY);
    expect(u2?.presence.online).toBe(0); // offline → no presence
    expect(u2?.engagementVoiceSamples).toBe(1);

    expect((await storage.getDay('U4', DAY))?.engagementVoiceSamples).toBe(0); // untracked voice
    expect(await storage.getDay('BOT', DAY)).toBeNull(); // bots skipped entirely
  });

  it('accrues across ticks: 3 online ticks ≈ 15 minutes', async () => {
    const members = [snap({ userId: 'U1', presence: 'active', voiceChannelId: 'VOICE2' })];
    await applyPoll(members, deps, NOW);
    await applyPoll(members, deps, new Date('2026-06-08T15:05:00Z'));
    await applyPoll(members, deps, new Date('2026-06-08T15:10:00Z'));
    const day = await storage.getDay('U1', DAY);
    expect(day?.presence.online).toBe(3);
    expect(day?.presence.samples).toBe(3);
    expect(day?.engagementVoiceSamples).toBe(3); // 3 × 5 ≈ 15 min in voice
  });

  it('records first/last online timestamps across ticks', async () => {
    const m = [snap({ userId: 'U1', presence: 'active' })];
    await applyPoll(m, deps, new Date('2026-06-08T09:00:00Z'));
    await applyPoll(m, deps, new Date('2026-06-08T17:00:00Z'));
    const day = await storage.getDay('U1', DAY);
    expect(day?.presence.firstOnlineAt).toBe('2026-06-08T09:00:00.000Z');
    expect(day?.presence.lastOnlineAt).toBe('2026-06-08T17:00:00.000Z');
  });

  it('counts idle members as present-but-idle, not active', async () => {
    const counts = await applyPoll([snap({ userId: 'U1', presence: 'idle' })], deps, NOW);
    expect(counts.presence).toBe(1); // idle still counts as present
    const day = await storage.getDay('U1', DAY);
    expect(day?.presence.samples).toBe(1);
    expect(day?.presence.online).toBe(0); // not active
    expect(day?.presence.idle).toBe(1);
  });
});
