/**
 * discord.js client wiring (M3). Only the message-driven intents live here;
 * presence/voice intents are added in M4 with the poller. The client maps each
 * live Message to an IncomingMessage and hands it to the router — keeping
 * discord.js types out of the handler layer.
 */
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { log } from '../logger.js';
import type { BotDeps } from './handlers.js';
import { fromDiscordMessage } from './message.js';
import { routeMessage } from './router.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // privileged — enable in the Developer Portal
      GatewayIntentBits.GuildMembers, // privileged — member roster for the poller
      GatewayIntentBits.GuildPresences, // privileged — online/idle/dnd status (feature 3)
      GatewayIntentBits.GuildVoiceStates, // who's connected to which voice channel (6b)
    ],
  });
}

/** Log gateway lifecycle events. discord.js auto-reconnects; we just observe. */
export function wireDiagnostics(client: Client): void {
  client.on(Events.Error, (err) => log.error('client error', err));
  client.on(Events.Warn, (msg) => log.warn(`client warning: ${msg}`));
  client.on(Events.ShardError, (err, id) => log.error(`shard ${id} error`, err));
  client.on(Events.ShardDisconnect, (_event, id) =>
    log.warn(`shard ${id} disconnected — reconnecting…`),
  );
  client.on(Events.ShardReconnecting, (id) => log.info(`shard ${id} reconnecting…`));
  client.on(Events.ShardResume, (id, replayed) =>
    log.info(`shard ${id} resumed (${replayed} events replayed)`),
  );
}

/** Attach diagnostics, the message router, and a ready log. Returns the client. */
export function wireBot(client: Client, deps: BotDeps): Client {
  wireDiagnostics(client);

  client.once(Events.ClientReady, (c) => {
    log.info(`connected as ${c.user.tag} — tracking guild ${deps.config.guildId}`);
  });

  client.on(Events.MessageCreate, (message) => {
    // Only the configured guild; ignore our own messages.
    if (message.guildId !== deps.config.guildId) return;
    if (message.author.id === client.user?.id) return;
    void routeMessage(fromDiscordMessage(message), deps).catch((err) => {
      log.error(`handler error in channel ${message.channelId}`, err);
    });
  });

  return client;
}
