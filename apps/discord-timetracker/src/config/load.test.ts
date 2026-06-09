import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, loadDotEnv } from './load.js';

const SF = '123456789012345678'; // a valid 18-digit snowflake shape

/** A complete, valid env (token + all required IDs). */
function validEnv(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DISCORD_TOKEN: 'tok',
    GUILD_ID: SF,
    GOALS_CHANNEL_ID: SF,
    SUMMARY_CHANNEL_ID: SF,
    CI_CHANNEL_ID: SF,
    ADMIN_ROLE_ID: SF,
    REPORT_CHANNEL_ID: SF,
    ...over,
  };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'ttcfg-'));

describe('loadConfig', () => {
  it('parses a complete env into a validated config (sqlite default)', () => {
    const cfg = loadConfig(tmp(), validEnv());
    expect(cfg.token).toBe('tok');
    expect(cfg.guildId).toBe(SF);
    expect(cfg.channels.ci).toBe(SF);
    expect(cfg.voiceChannelIds).toEqual([]); // default empty
    expect(cfg.timezone).toBe('America/New_York'); // default
    expect(cfg.storage).toEqual({ backend: 'sqlite', path: './data/timetracker.db' });
  });

  it('parses VOICE_CHANNEL_IDS as a comma/space-separated list', () => {
    const other = '987654321098765432';
    const cfg = loadConfig(tmp(), validEnv({ VOICE_CHANNEL_IDS: `${SF}, ${other}` }));
    expect(cfg.voiceChannelIds).toEqual([SF, other]);
  });

  it('treats an empty env var as unset (does not override / fail validation)', () => {
    // `.env` lines like `TRACKED_ROLE_ID=` must not set '' — that would fail the
    // optional snowflake check instead of being ignored.
    const cfg = loadConfig(tmp(), validEnv({ TRACKED_ROLE_ID: '', TIMEZONE: '  ' }));
    expect(cfg.trackedRoleId).toBeUndefined();
    expect(cfg.timezone).toBe('America/New_York'); // blank → default, not ''
  });

  it('loadDotEnv strips an inline comment from an unquoted value', () => {
    const dir = tmp();
    const key = 'TT_TEST_TZ'; // unique key, not already in process.env
    delete process.env[key];
    writeFileSync(join(dir, '.env'), `${key}=America/New_York    # the timezone\n`);
    loadDotEnv(dir);
    expect(process.env[key]).toBe('America/New_York');
    delete process.env[key];
  });

  it('loadDotEnv keeps a # that is inside a quoted value', () => {
    const dir = tmp();
    const key = 'TT_TEST_Q';
    delete process.env[key];
    writeFileSync(join(dir, '.env'), `${key}="a#b"\n`);
    loadDotEnv(dir);
    expect(process.env[key]).toBe('a#b');
    delete process.env[key];
  });

  it('rejects a missing token', () => {
    const { DISCORD_TOKEN: _omit, ...env } = validEnv();
    expect(() => loadConfig(tmp(), env)).toThrow(ConfigError);
  });

  it('rejects a malformed snowflake with a helpful message', () => {
    try {
      loadConfig(tmp(), validEnv({ GUILD_ID: 'not-a-snowflake' }));
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain('guildId');
    }
  });

  it('selects the dynamodb backend and requires a table', () => {
    const cfg = loadConfig(
      tmp(),
      validEnv({ STORAGE_BACKEND: 'dynamodb', DDB_TABLE: 'tt', AWS_REGION: 'us-east-1' }),
    );
    expect(cfg.storage).toEqual({ backend: 'dynamodb', table: 'tt', region: 'us-east-1' });

    expect(() => loadConfig(tmp(), validEnv({ STORAGE_BACKEND: 'dynamodb' }))).toThrow(ConfigError);
  });

  it('lets env override values from the config file', () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, 'timetracker.config.json'),
      JSON.stringify({
        guildId: SF,
        channels: { goals: SF, summary: SF, ci: SF },
        voiceChannelIds: [SF],
        adminRoleId: SF,
        reportChannelId: SF,
        timezone: 'UTC',
        storage: { backend: 'sqlite', path: './data/timetracker.db' },
      }),
    );
    // File says UTC; env wins with a different zone. Token only in env.
    const cfg = loadConfig(cwd, { DISCORD_TOKEN: 'tok', TIMEZONE: 'America/Chicago' });
    expect(cfg.timezone).toBe('America/Chicago');
    expect(cfg.guildId).toBe(SF); // came from the file
  });
});
