/**
 * 5-minute poller (M4): presence sampling (feature 3) + voice-engagement
 * sampling (feature 6b). The discord.js-specific snapshot collection is split
 * from the pure `applyPoll` write logic so the sampling rules are unit-testable
 * without a live gateway.
 */
import { type Client, Events, type Guild } from 'discord.js';
import { POLL_INTERVAL_MS } from '../domain/constants.js';
import { dayKeyFor } from '../domain/dayKey.js';
import type { PresenceState } from '../storage/StorageAdapter.js';
import type { BotDeps } from './handlers.js';

export { POLL_INTERVAL_MS };

/** A point-in-time view of one tracked member. */
export interface MemberSnapshot {
  userId: string;
  isBot: boolean;
  displayName: string;
  /** active (online/dnd) · idle (away) · offline (offline/invisible/unknown). */
  presence: PresenceState | 'offline';
  /** Voice channel the member is connected to right now, or null. */
  voiceChannelId: string | null;
}

/**
 * Apply one poll tick. For each non-bot member: if present (active or idle),
 * record a presence sample tagged with that state; if sitting in a tracked
 * voice channel, record a voice sample. Offline members are skipped. Pure over
 * storage — only depends on the snapshot + config + `now`.
 */
export async function applyPoll(
  members: MemberSnapshot[],
  deps: BotDeps,
  now: Date,
): Promise<{ presence: number; voice: number }> {
  const date = dayKeyFor(now, deps.config.timezone);
  const at = now.toISOString();
  const trackedVoice = new Set(deps.config.voiceChannelIds);
  let presence = 0;
  let voice = 0;
  for (const m of members) {
    if (m.isBot) continue;
    await deps.storage.setUserName(m.userId, m.displayName);
    if (m.presence !== 'offline') {
      await deps.storage.recordPresenceSample(m.userId, date, m.presence, at);
      presence++;
    }
    if (m.voiceChannelId && trackedVoice.has(m.voiceChannelId)) {
      await deps.storage.incrementVoiceSamples(m.userId, date);
      voice++;
    }
  }
  return { presence, voice };
}

/** Read the guild's member cache into snapshots, honouring `trackedRoleId`. */
export function collectSnapshots(guild: Guild, deps: BotDeps): MemberSnapshot[] {
  const { trackedRoleId } = deps.config;
  const snapshots: MemberSnapshot[] = [];
  for (const member of guild.members.cache.values()) {
    if (trackedRoleId && !member.roles.cache.has(trackedRoleId)) continue;
    const status = member.presence?.status; // 'online'|'idle'|'dnd'|'offline'|undefined
    const presence: PresenceState | 'offline' =
      status === 'online' || status === 'dnd' ? 'active' : status === 'idle' ? 'idle' : 'offline';
    snapshots.push({
      userId: member.id,
      isBot: member.user.bot,
      displayName: member.displayName,
      presence,
      voiceChannelId: member.voice.channelId ?? null,
    });
  }
  return snapshots;
}

/**
 * Attach the poller to a client: on ready, fetch members (populates the cache
 * presence sampling reads), then sample every `intervalMs`. Returns a stop fn.
 */
export function attachPoller(
  client: Client,
  deps: BotDeps,
  intervalMs = POLL_INTERVAL_MS,
): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;

  const pollOnce = async () => {
    const guild = client.guilds.cache.get(deps.config.guildId);
    if (!guild) return;
    await applyPoll(collectSnapshots(guild, deps), deps, new Date());
  };

  client.once(Events.ClientReady, async () => {
    const guild = client.guilds.cache.get(deps.config.guildId);
    if (!guild) {
      console.error(`  ! poller: guild ${deps.config.guildId} not found — not polling`);
      return;
    }
    await guild.members.fetch(); // hydrate member + presence cache
    timer = setInterval(() => {
      void pollOnce().catch((err) => console.error('  ! poll tick error:', err));
    }, intervalMs);
    console.log(`  ✓ polling presence + voice every ${intervalMs / 60000} min`);
  });

  return () => {
    if (timer) clearInterval(timer);
  };
}
