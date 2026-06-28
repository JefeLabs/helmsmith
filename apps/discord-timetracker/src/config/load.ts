/**
 * Config loader: merge `timetracker.config.json` (non-secret) with environment
 * variables (which win), then validate against the schema. The token comes
 * only from env. Designed to be the single entry point every command uses.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type Config, ConfigSchema } from './schema.js';

export const CONFIG_FILENAME = 'timetracker.config.json';

/** Thrown when config is missing/invalid — carries a human-readable summary. */
export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues?: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Minimal zero-dep `.env` reader. Only sets keys not already present in
 * `process.env` (real env wins over the file). Bun auto-loads `.env`, but the
 * `tsx` dev path doesn't — this keeps both runtimes consistent. Supports
 * `KEY=value`, `#` comments, blank lines, and optional surrounding quotes.
 */
export function loadDotEnv(cwd = process.cwd()): void {
  const path = join(cwd, '.env');
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1); // quoted: keep contents verbatim
    } else {
      // Unquoted: strip an inline ` #…` comment (e.g. `TIMEZONE=America/New_York # tz`).
      const comment = value.search(/\s#/);
      if (comment !== -1) value = value.slice(0, comment).trimEnd();
    }
    process.env[key] = value;
  }
}

/** Read and parse the JSON config file, if it exists. */
function readConfigFile(cwd: string): Record<string, unknown> {
  const path = join(cwd, CONFIG_FILENAME);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid JSON: ${(err as Error).message}`);
  }
}

/** Parse a comma/space-separated id list from env (e.g. VOICE_CHANNEL_IDS). */
function parseIdList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return ids;
}

/** Parse a boolean env var (true/1/yes/on → true; false/0/no/off → false). */
function parseBool(raw: string | undefined): boolean | undefined {
  const v = blank(raw)?.toLowerCase();
  if (v === undefined) return undefined;
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return undefined;
}

/** Drop keys whose value is `undefined` so env-overlay only sets real values. */
function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Treat an empty/whitespace env var as absent. Without this, a `.env` line like
 * `TRACKED_ROLE_ID=` (common for optional keys) sets `''`, which `??` does NOT
 * skip — so the empty string overrides the file/default and fails validation.
 */
function blank(v: string | undefined): string | undefined {
  return v && v.trim() !== '' ? v : undefined;
}

/**
 * Build the storage block from env, falling back to the file's block. Env
 * `STORAGE_BACKEND` selects the variant; per-backend fields overlay.
 */
function resolveStorage(env: NodeJS.ProcessEnv, fileStorage: unknown): unknown {
  const backend = blank(env.STORAGE_BACKEND) ?? (fileStorage as { backend?: string })?.backend;
  if (backend === 'dynamodb') {
    return defined({
      backend: 'dynamodb',
      table: blank(env.DDB_TABLE),
      region: blank(env.AWS_REGION),
      ...(fileStorage as object),
    });
  }
  // default: sqlite
  return defined({
    backend: 'sqlite',
    path: blank(env.SQLITE_PATH),
    ...(fileStorage as object),
  });
}

/**
 * Load + validate config. Env overlays the file; the token is env-only.
 * Throws `ConfigError` with a readable message on any problem.
 */
export function loadConfig(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Config {
  loadDotEnv(cwd);
  const file = readConfigFile(cwd);

  const merged = {
    token: blank(env.DISCORD_TOKEN),
    guildId: blank(env.GUILD_ID) ?? file.guildId,
    channels: {
      ...(file.channels as object),
      ...defined({
        goals: blank(env.GOALS_CHANNEL_ID),
        summary: blank(env.SUMMARY_CHANNEL_ID),
        ci: blank(env.CI_CHANNEL_ID),
      }),
    },
    voiceChannelIds: parseIdList(env.VOICE_CHANNEL_IDS) ?? file.voiceChannelIds,
    adminRoleId: blank(env.ADMIN_ROLE_ID) ?? file.adminRoleId,
    reportChannelId: blank(env.REPORT_CHANNEL_ID) ?? file.reportChannelId,
    trackedRoleId: blank(env.TRACKED_ROLE_ID) ?? file.trackedRoleId,
    trackedUserIds: parseIdList(env.TRACKED_USER_IDS) ?? file.trackedUserIds,
    timezone: blank(env.TIMEZONE) ?? file.timezone,
    weekStartsOn: blank(env.WEEK_STARTS_ON) ?? file.weekStartsOn,
    schedule: {
      ...(file.schedule as object),
      ...defined({ dailyAt: blank(env.SCHEDULE_DAILY_AT) }),
      endOfDay: {
        ...((file.schedule as { endOfDay?: object })?.endOfDay ?? {}),
        ...defined({
          enabled: parseBool(env.SCHEDULE_EOD_ENABLED),
          mode: blank(env.SCHEDULE_EOD_MODE),
          at: blank(env.SCHEDULE_EOD_AT),
          deadlineAt: blank(env.SCHEDULE_EOD_DEADLINE),
          weekdaysOnly: parseBool(env.SCHEDULE_EOD_WEEKDAYS_ONLY),
        }),
      },
    },
    capture: file.capture,
    storage: resolveStorage(env, file.storage),
  };

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigError(formatIssues(result.error.issues), result.error.issues);
  }
  return result.data;
}

/** Render zod issues as an indented, copy-pasteable list. */
export function formatIssues(issues: z.ZodIssue[]): string {
  const lines = issues.map((i) => {
    const path = i.path.join('.') || '(root)';
    return `  • ${path}: ${i.message}`;
  });
  return `Invalid configuration — fix the following and re-run:\n${lines.join('\n')}`;
}
