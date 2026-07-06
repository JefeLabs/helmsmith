/**
 * Admin-only slash commands (M7) — feature 1 "only seen by admin". `/report`
 * and `/status` are registered as guild commands (instant) and gated to the
 * admin role (or Administrator permission); all replies are ephemeral, so
 * tracked data never lands in a public channel.
 */
import {
  type ChatInputCommandInteraction,
  type Client,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { todayKey } from '../domain/dayKey.js';
import { dailyMessage, weeklyMessage } from '../reports/discord.js';
import type { ReportService } from '../reports/ReportService.js';
import type { BotDeps } from './handlers.js';

const COMMANDS = [
  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Show a daily or weekly activity summary')
    .addStringOption((o) =>
      o
        .setName('period')
        .setDescription('daily (default) or weekly')
        .addChoices({ name: 'daily', value: 'daily' }, { name: 'weekly', value: 'weekly' }),
    )
    .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD (default: today)')),
  new SlashCommandBuilder().setName('status').setDescription('Bot + tracking status'),
].map((c) => c.toJSON());

/** Pure admin check — testable without a live interaction. */
export function isAdminMember(opts: {
  hasAdminPermission: boolean;
  roleIds: string[];
  adminRoleId: string;
}): boolean {
  return opts.hasAdminPermission || opts.roleIds.includes(opts.adminRoleId);
}

/** Extract the role-id list from either interaction member shape. */
function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles; // APIInteractionGuildMember → string[]
  return [...roles.cache.keys()]; // GuildMemberRoleManager
}

function formatUptime(ms: number | null): string {
  if (!ms) return 'just started';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function attachSlashCommands(client: Client, deps: BotDeps, reports: ReportService): void {
  client.once(Events.ClientReady, async (c) => {
    try {
      const rest = new REST({ version: '10' }).setToken(deps.config.token);
      await rest.put(Routes.applicationGuildCommands(c.user.id, deps.config.guildId), {
        body: COMMANDS,
      });
      console.log('  ✓ registered /report and /status (admin-only)');
    } catch (err) {
      console.error('  ! failed to register slash commands:', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const allowed = isAdminMember({
      hasAdminPermission: Boolean(
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
      ),
      roleIds: memberRoleIds(interaction),
      adminRoleId: deps.config.adminRoleId,
    });
    if (!allowed) {
      await interaction.reply({ content: '⛔ Admins only.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      if (interaction.commandName === 'report') await handleReport(interaction, deps, reports);
      else if (interaction.commandName === 'status')
        await handleStatus(interaction, deps, reports, client);
    } catch (err) {
      console.error('  ! slash handler error:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: 'Something went wrong.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
    }
  });
}

async function handleReport(
  interaction: ChatInputCommandInteraction,
  deps: BotDeps,
  reports: ReportService,
): Promise<void> {
  const period = interaction.options.getString('period') === 'weekly' ? 'weekly' : 'daily';
  const date = interaction.options.getString('date') ?? todayKey(deps.config.timezone);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const msg =
    period === 'weekly'
      ? await weeklyMessage(reports, date, deps.config.timezone)
      : await dailyMessage(reports, date, deps.config.timezone);
  await interaction.editReply(msg);
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  deps: BotDeps,
  reports: ReportService,
  client: Client,
): Promise<void> {
  const today = todayKey(deps.config.timezone);
  const summary = await reports.daily(today);
  await interaction.reply({
    content:
      `🟢 **Tracking** — guild ${deps.config.guildId}\n` +
      `Today (${today}): **${summary.users.length}** active users\n` +
      `Storage: ${deps.config.storage.backend} · uptime: ${formatUptime(client.uptime)}`,
    flags: MessageFlags.Ephemeral,
  });
}
