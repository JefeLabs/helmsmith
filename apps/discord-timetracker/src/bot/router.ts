/**
 * Channel-id router. Picks the handler for a message, then claims the message
 * id (dedup) before running it — so a gateway redelivery on reconnect can't
 * double-count CI/engagement. The CI channel is matched FIRST and bypasses the
 * "ignore bots" guard — the CI poster ("GitHub Monitor") is itself a bot, so
 * dropping bots before this branch would silently zero out every CI submission.
 */
import { isTracked } from '../domain/tracked.js';
import {
  type BotDeps,
  handleCiSubmission,
  handleEndOfDay,
  handleEngagementText,
  handleStartOfDay,
} from './handlers.js';
import type { IncomingMessage } from './message.js';

type Handler = (m: IncomingMessage, deps: BotDeps) => Promise<unknown>;

/** Resolve the handler for a message, or null if this message isn't tracked. */
function selectHandler(m: IncomingMessage, config: BotDeps['config']): Handler | null {
  if (m.channelId === config.channels.ci) return handleCiSubmission; // bot poster — before the bot guard
  if (m.authorIsBot) return null; // ignore bots (and our own messages) elsewhere
  // Human-authored signals: only from tracked users (CI is filtered per-actor).
  if (!isTracked(m.authorId, config.trackedUserIds)) return null;
  if (m.channelId === config.channels.goals) return handleStartOfDay;
  if (m.channelId === config.channels.summary) return handleEndOfDay;
  if (config.voiceChannelIds.includes(m.channelId)) return handleEngagementText;
  return null;
}

export async function routeMessage(m: IncomingMessage, deps: BotDeps): Promise<void> {
  const handler = selectHandler(m, deps.config);
  if (!handler) return;
  // Claim + handle atomically: the dedup marker and the handler's writes commit
  // together, or roll back together. Claiming alone (the old order) meant an
  // interrupted handler left a marker with no effect — and `markProcessed`
  // returns false forever after, so neither a redelivery nor `backfill` could
  // ever recover it. Now an interrupted message stays unclaimed and replayable.
  await deps.storage.transaction(async () => {
    // Idempotency: only the first delivery of a message id is processed.
    if (!(await deps.storage.markProcessed(m.id))) return;
    await handler(m, deps);
  });
}
