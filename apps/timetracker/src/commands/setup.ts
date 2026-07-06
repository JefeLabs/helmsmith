/**
 * Interactive first-run wizard. Collects non-secret config into
 * `timetracker.config.json` and (optionally) writes the bot token to `.env`.
 * Secrets never go in the JSON file. Implemented in M1.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { confirm, input, password, select } from '@inquirer/prompts';
import { CONFIG_FILENAME, formatIssues } from '../config/load.js';
import { ConfigSchema, type PersistedConfig } from '../config/schema.js';
import { isValidTimeZone } from '../domain/dayKey.js';

const isSnowflake = (v: string) => /^\d{17,20}$/.test(v.trim());
const snowflakeValidator = (v: string) =>
  isSnowflake(v)
    ? true
    : 'Enter a Discord ID (17–20 digits). Enable Developer Mode → right-click → Copy ID.';

export async function runSetup(cwd = process.cwd()): Promise<void> {
  console.log('\n  timetracker setup\n  ─────────────────────────');
  console.log('  Tip: Discord → Settings → Advanced → Developer Mode, then');
  console.log('  right-click a server/channel/role → "Copy ID".\n');

  const configPath = join(cwd, CONFIG_FILENAME);
  if (existsSync(configPath)) {
    const overwrite = await confirm({
      message: `${CONFIG_FILENAME} already exists. Overwrite it?`,
      default: false,
    });
    if (!overwrite) {
      console.log('  Aborted — existing config kept.\n');
      return;
    }
  }

  // ── Identity ──────────────────────────────────────────────────────────
  const guildId = await input({ message: 'Server (guild) ID:', validate: snowflakeValidator });

  // ── Tracked channels ──────────────────────────────────────────────────
  const goals = await input({
    message: '#goals-for-the-day channel ID:',
    validate: snowflakeValidator,
  });
  const summary = await input({
    message: '#summary-of-the-day channel ID:',
    validate: snowflakeValidator,
  });
  const ci = await input({
    message: '#ci-cd-notifications channel ID:',
    validate: snowflakeValidator,
  });

  // ── Engagement voice channels (configurable subset) ───────────────────
  const voiceRaw = await input({
    message: 'Voice channel IDs for engagement (comma-separated — DevOffice, TriageRoom, …):',
    validate: (v) => {
      const ids = v
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.length === 0 || ids.every(isSnowflake)
        ? true
        : 'Each entry must be a Discord channel ID (17–20 digits).';
    },
  });
  const voiceChannelIds = voiceRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // ── Admin / reporting ─────────────────────────────────────────────────
  const adminRoleId = await input({
    message: 'Admin role ID (who can run commands / see reports):',
    validate: snowflakeValidator,
  });
  const reportChannelId = await input({
    message: 'Admin-only report channel ID:',
    validate: snowflakeValidator,
  });
  const trackedRaw = await input({
    message: 'Tracked-members role ID (optional — blank = all non-bot members):',
    validate: (v) => v.trim() === '' || snowflakeValidator(v) === true || snowflakeValidator(v),
  });
  const trackedRoleId = trackedRaw.trim() === '' ? undefined : trackedRaw.trim();

  // ── Behaviour ─────────────────────────────────────────────────────────
  const timezone = await input({
    message: 'Timezone (IANA, e.g. America/New_York):',
    default: 'America/New_York',
    validate: (v) => (isValidTimeZone(v.trim()) ? true : `Unknown IANA timezone: ${v}`),
  });

  // ── Storage ───────────────────────────────────────────────────────────
  const backend = await select({
    message: 'Storage backend:',
    choices: [
      { value: 'sqlite' as const, name: 'SQLite (local file) — recommended for v1' },
      { value: 'dynamodb' as const, name: 'DynamoDB (AWS)' },
    ],
  });

  const storage =
    backend === 'sqlite'
      ? {
          backend,
          path: await input({ message: 'SQLite file path:', default: './data/timetracker.db' }),
        }
      : {
          backend,
          table: await input({ message: 'DynamoDB table name:', default: 'timetracker' }),
          region: await input({ message: 'AWS region:', default: 'us-east-1' }),
        };

  // ── Assemble + validate (use a placeholder token just for validation) ──
  const persisted = {
    guildId,
    channels: { goals, summary, ci },
    voiceChannelIds,
    adminRoleId,
    reportChannelId,
    ...(trackedRoleId ? { trackedRoleId } : {}),
    timezone: timezone.trim(),
    capture: { startOfDayFirstWins: true, endOfDayLastWins: true },
    storage,
  };

  const check = ConfigSchema.safeParse({ ...persisted, token: 'placeholder-for-validation' });
  if (!check.success) {
    console.error(`\n${formatIssues(check.error.issues)}\n`);
    return;
  }
  // Strip the placeholder token before persisting — secrets never hit the file.
  const { token: _token, ...toWrite } = check.data;
  void _token;

  writeConfigFile(configPath, toWrite);
  console.log(`\n  ✓ wrote ${CONFIG_FILENAME}`);

  // ── Token → .env (optional) ───────────────────────────────────────────
  const token = await password({
    message: 'Discord bot token (stored in .env, not the config file):',
    mask: '•',
  });
  if (token.trim()) {
    writeTokenToEnv(join(cwd, '.env'), token.trim());
    console.log('  ✓ wrote DISCORD_TOKEN to .env');
  } else {
    console.log('  · no token entered — set DISCORD_TOKEN in your environment before `start`.');
  }

  console.log('\n  Done. Next:');
  console.log('    timetracker start    # begins tracking (M3)\n');
}

function writeConfigFile(path: string, config: PersistedConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** Upsert DISCORD_TOKEN in .env without clobbering other keys. */
function writeTokenToEnv(envPath: string, token: string): void {
  const line = `DISCORD_TOKEN=${token}`;
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `${line}\n`);
    return;
  }
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const idx = lines.findIndex((l) => l.trim().startsWith('DISCORD_TOKEN='));
  if (idx === -1) {
    appendFileSync(envPath, `${lines.at(-1)?.trim() === '' ? '' : '\n'}${line}\n`);
  } else {
    lines[idx] = line;
    writeFileSync(envPath, lines.join('\n'));
  }
}
