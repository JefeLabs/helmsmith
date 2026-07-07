/**
 * `figma` verb group — the Figma tracker's operational surface:
 *
 *   figma start        run the tracker (webhook receiver + poller + presence)
 *   figma sync-files   seed figma_files from the team's projects (§6.5)
 *   figma map-members  pair Figma users ↔ Discord users, one-time manual (§6.4)
 *   figma status       heartbeats, counts, unmapped members — ops at a glance
 *
 * `start` is a SEPARATE long-running process from the Discord bot by design:
 * either can restart without touching the other; both share the SQLite file.
 */
import { input, select } from '@inquirer/prompts';
import { Events } from 'discord.js';
import { createClient } from '../bot/client.js';
import { ConfigError, loadConfig } from '../config/load.js';
import type { Config } from '../config/schema.js';
import { todayKey } from '../domain/dayKey.js';
import { FigmaApi } from '../figma/api.js';
import { FIGMA_META } from '../figma/context.js';
import { startFigmaTracker } from '../figma/tracker.js';
import { log } from '../logger.js';
import { reportServiceFor } from '../reports/ReportService.js';
import { renderFigmaDaily } from '../reports/render.js';
import { type FigmaStorage, supportsFigma } from '../storage/FigmaStorage.js';
import { createStorage } from '../storage/factory.js';
import type { StorageAdapter } from '../storage/StorageAdapter.js';

const MANUAL = '__manual__';
const SKIP = '__skip__';
const isSnowflake = (v: string) => /^\d{17,20}$/.test(v.trim());

/** Shared preamble: config (figma block required) + figma-capable storage. */
async function open(cwd: string): Promise<{
  config: Config;
  storage: StorageAdapter & FigmaStorage;
} | null> {
  let config: Config;
  try {
    config = loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n${err.message}\n\nRun \`timetracker setup\` / edit .env first.\n`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }
  if (!config.figma) {
    console.error('\nFigma tracking is not configured — set FIGMA_TOKEN and FIGMA_TEAM_ID.\n');
    process.exitCode = 1;
    return null;
  }
  const storage = await createStorage(config.storage);
  if (!supportsFigma(storage)) {
    console.error(
      `\nFigma tracking requires the sqlite storage backend (configured: ${config.storage.backend}).\n`,
    );
    await storage.close();
    process.exitCode = 1;
    return null;
  }
  return { config, storage };
}

export async function runFigmaStart(cwd = process.cwd()): Promise<void> {
  const opened = await open(cwd);
  if (!opened) return;
  const { config, storage } = opened;

  let runtime: Awaited<ReturnType<typeof startFigmaTracker>>;
  try {
    runtime = await startFigmaTracker(config, storage);
  } catch (err) {
    log.error('figma tracker failed to start', err);
    await storage.close();
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} — figma tracker shutting down…`);
    await runtime.stop();
    await storage.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  log.info('figma tracker running — Ctrl-C to stop');
}

export async function runFigmaSyncFiles(cwd = process.cwd()): Promise<void> {
  const opened = await open(cwd);
  if (!opened) return;
  const { config, storage } = opened;
  const figma = config.figma!;
  try {
    const api = new FigmaApi(figma.token);
    const projects = await api.getTeamProjects(figma.teamId);
    let files = 0;
    for (const project of projects) {
      for (const f of await api.getProjectFiles(project.id)) {
        await storage.upsertFigmaFile({ fileKey: f.key, name: f.name, project: project.name });
        files++;
      }
    }
    console.log(`\n  ✓ synced ${files} file(s) across ${projects.length} project(s):\n`);
    for (const f of await storage.listFigmaFiles()) {
      console.log(
        `    ${f.tracked ? '●' : '○'} ${f.name ?? f.fileKey}  (${f.project ?? 'no project'})`,
      );
    }
    console.log('\n  ● tracked — the poller sweeps these. New files auto-add on webhook events.\n');
  } finally {
    await storage.close();
  }
}

export async function runFigmaMapMembers(cwd = process.cwd()): Promise<void> {
  const opened = await open(cwd);
  if (!opened) return;
  const { storage } = opened;
  try {
    const members = await storage.listFigmaMembers();
    if (members.length === 0) {
      console.log(
        '\n  No Figma members seen yet. Run `figma sync-files` then `figma start` (or wait\n' +
          '  for a poll sweep) so member handles appear from version/comment history.\n',
      );
      return;
    }
    const names = await storage.getUserNames();
    const knownIds = Object.keys(names);

    console.log('\n  Current Figma → Discord mappings:');
    for (const m of members) {
      const mapped = m.discordUserId ? (names[m.discordUserId] ?? m.discordUserId) : '(unmapped)';
      console.log(`    ${m.handle.padEnd(20)} → ${mapped}`);
    }

    for (const m of members.filter((m) => !m.discordUserId)) {
      const choice = await select({
        message: `Map Figma user "${m.handle}" to which Discord user?`,
        choices: [
          ...knownIds.map((id) => ({ name: `${names[id]} (${id})`, value: id })),
          { name: 'Enter an ID manually…', value: MANUAL },
          { name: 'Skip for now', value: SKIP },
        ],
      });
      if (choice === SKIP) continue;
      const discordId =
        choice === MANUAL
          ? await input({
              message: 'Discord user ID:',
              validate: (v) => (isSnowflake(v) ? true : 'Enter a Discord user ID (17–20 digits).'),
            })
          : choice;
      await storage.linkIdentity('figma', m.figmaUserId, discordId.trim());
      console.log(`    ✓ ${m.handle} → ${names[discordId.trim()] ?? discordId}`);
    }
    console.log('');
  } finally {
    await storage.close();
  }
}

export interface FigmaReportOptions {
  date?: string;
  json?: boolean;
  post?: boolean;
}

/**
 * `figma report` — the Figma activity feed (presence now, per-member activity,
 * file heat, recent events) as text, `--json`, or posted to the Discord report
 * channel. Unlike `timetracker report`, this surfaces Figma users even when
 * they aren't yet mapped to a Discord identity.
 */
export async function runFigmaReport(opts: FigmaReportOptions, cwd = process.cwd()): Promise<void> {
  const opened = await open(cwd);
  if (!opened) return;
  const { config, storage } = opened;
  try {
    const reports = reportServiceFor(storage, config);
    const date = opts.date ?? todayKey(config.timezone);
    const summary = await reports.figmaDaily(date);
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    const text = renderFigmaDaily(summary, config.timezone);
    if (opts.post) {
      await postFigmaReport(config, text);
      return;
    }
    console.log(text);
  } finally {
    await storage.close();
  }
}

/** Post the figma report to the Discord report channel, chunked to Discord's
 *  2000-char message limit and fenced so the table columns stay aligned. */
async function postFigmaReport(config: Config, text: string): Promise<void> {
  const client = createClient();
  try {
    await new Promise<void>((resolve, reject) => {
      client.once(Events.ClientReady, (ready) => {
        ready.channels
          .fetch(config.reportChannelId)
          .then(async (channel) => {
            if (!channel?.isTextBased() || !('send' in channel)) {
              throw new Error('report channel is not a sendable text channel');
            }
            for (const chunk of fenceChunks(text)) await channel.send(chunk);
            const name = ('name' in channel && channel.name) || config.reportChannelId;
            console.log(`✓ posted figma report to #${name}`);
          })
          .then(resolve, reject);
      });
      client.login(config.token).catch(reject);
    });
  } finally {
    await client.destroy();
  }
}

/** Split text into ```-fenced messages under Discord's 2000-char cap. */
function fenceChunks(text: string, limit = 1900): string[] {
  const chunks: string[] = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if (buf.length + line.length + 1 > limit) {
      chunks.push('```\n' + buf + '\n```');
      buf = '';
    }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) chunks.push('```\n' + buf + '\n```');
  return chunks;
}

export async function runFigmaStatus(cwd = process.cwd()): Promise<void> {
  const opened = await open(cwd);
  if (!opened) return;
  const { config, storage } = opened;
  try {
    const today = todayKey(config.timezone);
    const [files, members, events, openPresence] = await Promise.all([
      storage.listFigmaFiles(),
      storage.listFigmaMembers(),
      storage.listFigmaEventsRange(today, today),
      storage.listOpenFigmaPresence(),
    ]);
    const meta = async (key: string) => (await storage.getMeta(key)) ?? '—';
    const heartbeat = await storage.getMeta(FIGMA_META.presenceHeartbeat);
    const staleMs = heartbeat ? Date.now() - Date.parse(heartbeat) : undefined;
    const stale =
      staleMs !== undefined && staleMs > (config.figma?.presence.staleAfterSec ?? 180) * 1000;

    console.log(`\n  Figma tracker status (${today})\n`);
    console.log(`    files tracked:     ${files.filter((f) => f.tracked).length}/${files.length}`);
    console.log(
      `    members mapped:    ${members.filter((m) => m.discordUserId).length}/${members.length}` +
        (members.some((m) => !m.discordUserId) ? '   (run `figma map-members`)' : ''),
    );
    console.log(`    events today:      ${events.length}`);
    console.log(`    last event at:     ${await meta(FIGMA_META.lastEventAt)}`);
    console.log(`    last poll at:      ${await meta(FIGMA_META.lastPollAt)}`);
    console.log(
      `    presence:          ${openPresence.length} in-file now · heartbeat ${heartbeat ?? '—'}` +
        (stale ? '  ⚠ STALE' : ''),
    );
    console.log('');
  } finally {
    await storage.close();
  }
}
