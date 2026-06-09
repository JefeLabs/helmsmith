/**
 * Zod-validated config. The resolved shape the rest of the bot consumes is
 * `Config`. Secrets (the bot token) are part of the schema but only ever
 * sourced from env in the loader — never persisted to the config file.
 */
import { z } from 'zod';
import { isValidTimeZone } from '../domain/dayKey.js';

/** Discord snowflake: a 17–20 digit numeric id. */
const SNOWFLAKE_RE = /^\d{17,20}$/;
const snowflake = (label: string) =>
  z.string().regex(SNOWFLAKE_RE, `${label} must be a Discord snowflake (17–20 digit id)`);
const snowflakeBare = z
  .string()
  .regex(SNOWFLAKE_RE, 'must be a Discord snowflake (17–20 digit id)');

const SqliteStorageSchema = z.object({
  backend: z.literal('sqlite'),
  path: z.string().min(1).default('./data/timetracker.db'),
});

const DynamoStorageSchema = z.object({
  backend: z.literal('dynamodb'),
  table: z.string().min(1, 'DDB_TABLE is required for the dynamodb backend'),
  region: z.string().min(1).default('us-east-1'),
});

export const StorageSchema = z.discriminatedUnion('backend', [
  SqliteStorageSchema,
  DynamoStorageSchema,
]);

export const ChannelsSchema = z.object({
  goals: snowflake('GOALS_CHANNEL_ID'),
  summary: snowflake('SUMMARY_CHANNEL_ID'),
  ci: snowflake('CI_CHANNEL_ID'),
});

export const ScheduleSchema = z
  .object({
    // Push daily/weekly summaries to the report channel.
    enabled: z.boolean().default(true),
    // Local time-of-day (HH:MM, 24h) to post. Daily covers the previous day;
    // on the week-start day it also posts the previous week.
    dailyAt: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'dailyAt must be HH:MM (24-hour)')
      .default('09:00'),
  })
  .default({});

export const CaptureSchema = z
  .object({
    // First goals post of the day marks start-of-day; later posts don't move it.
    startOfDayFirstWins: z.boolean().default(true),
    // Last summary post of the day marks end-of-day.
    endOfDayLastWins: z.boolean().default(true),
  })
  .default({});

export const ConfigSchema = z.object({
  /** Bot token — sourced from DISCORD_TOKEN, never written to the config file. */
  token: z.string().min(1, 'DISCORD_TOKEN is required'),
  guildId: snowflake('GUILD_ID'),
  channels: ChannelsSchema,
  /**
   * Voice channels that count toward engagement (DevOffice, TriageRoom, …).
   * Drives BOTH signals: voice-connection samples AND text messages posted in
   * each channel's embedded chat (same channel id). Aggregated per user/day.
   */
  voiceChannelIds: z.array(snowflakeBare).default([]),
  adminRoleId: snowflake('ADMIN_ROLE_ID'),
  reportChannelId: snowflake('REPORT_CHANNEL_ID'),
  /** Optional: only track members with this role. Unset → all non-bot members. */
  trackedRoleId: snowflake('TRACKED_ROLE_ID').optional(),
  timezone: z
    .string()
    .default('America/New_York')
    .refine(isValidTimeZone, (tz) => ({ message: `unknown IANA timezone: ${tz}` })),
  /** Week boundary for weekly reports. */
  weekStartsOn: z.enum(['monday', 'sunday']).default('monday'),
  schedule: ScheduleSchema,
  capture: CaptureSchema,
  storage: StorageSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type StorageConfig = z.infer<typeof StorageSchema>;
export type SqliteStorageConfig = z.infer<typeof SqliteStorageSchema>;
export type DynamoStorageConfig = z.infer<typeof DynamoStorageSchema>;
export type Channels = z.infer<typeof ChannelsSchema>;

/**
 * The non-secret subset persisted to `timetracker.config.json` by `setup`.
 * Token is intentionally excluded — it lives in `.env` / the secret store.
 */
export type PersistedConfig = Omit<Config, 'token'>;
