/**
 * The narrow message shape the router/handlers operate on. discord.js `Message`
 * types stay at the edge (client.ts maps to this), so handler logic is pure and
 * unit-testable without a live gateway.
 */
import type { Message } from 'discord.js';

export interface IncomingMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorIsBot: boolean;
  /** Best display name: server nickname → global name → username. */
  authorName: string;
  content: string;
  createdAt: Date;
}

export function fromDiscordMessage(m: Message): IncomingMessage {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.author.id,
    authorIsBot: m.author.bot,
    authorName: m.member?.displayName ?? m.author.displayName ?? m.author.username,
    content: m.content,
    createdAt: m.createdAt,
  };
}
