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

  it('parses TRACKED_USER_IDS and the end-of-day schedule from env', () => {
    const a = '111111111111111111';
    const b = '222222222222222222';
    const cfg = loadConfig(
      tmp(),
      validEnv({
        TRACKED_USER_IDS: `${a}, ${b}`,
        SCHEDULE_EOD_ENABLED: 'true',
        SCHEDULE_EOD_MODE: 'completion',
        SCHEDULE_EOD_DEADLINE: '22:00',
      }),
    );
    expect(cfg.trackedUserIds).toEqual([a, b]);
    expect(cfg.schedule.endOfDay).toMatchObject({
      enabled: true,
      mode: 'completion',
      deadlineAt: '22:00',
      weekdaysOnly: true, // default
    });
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

  it('loadDotEnv treats a comment-only value as unset (copied .env.example line)', () => {
    // `.env.example` uses `KEY=          # annotation` for keys left empty.
    // After trimming, the value starts with `#` and must resolve to empty —
    // not the annotation text (which would fail url/snowflake validation).
    const dir = tmp();
    const key = 'TT_TEST_EMPTY';
    delete process.env[key];
    writeFileSync(join(dir, '.env'), `${key}=          # public HTTPS route; set → auto-register\n`);
    loadDotEnv(dir);
    expect(process.env[key]).toBe('');
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

  it('omits the figma block entirely when no figma signal exists', () => {
    const cfg = loadConfig(tmp(), validEnv());
    expect(cfg.figma).toBeUndefined();
  });

  it('parses a full figma env block with defaults', () => {
    const cfg = loadConfig(
      tmp(),
      validEnv({ FIGMA_TOKEN: 'figd_x', FIGMA_TEAM_ID: '12345', FIGMA_FILE_KEYS: 'aaa, bbb' }),
    );
    expect(cfg.figma).toMatchObject({
      token: 'figd_x',
      teamId: '12345',
      fileKeys: ['aaa', 'bbb'],
      pollIntervalMin: 10,
      burstGapMin: 30,
      burstPadMin: 15,
      webhook: { enabled: false, port: 3846 },
      presence: { enabled: false, pollSec: 45, staleAfterSec: 180 },
    });
  });

  it('requires FIGMA_TOKEN once any figma signal is present', () => {
    expect(() => loadConfig(tmp(), validEnv({ FIGMA_TEAM_ID: '12345' }))).toThrow(ConfigError);
  });

  it('requires the webhook passcode when the webhook receiver is enabled', () => {
    const base = { FIGMA_TOKEN: 'figd_x', FIGMA_TEAM_ID: '12345' };
    expect(() =>
      loadConfig(tmp(), validEnv({ ...base, FIGMA_WEBHOOK_ENABLED: 'true' })),
    ).toThrow(/FIGMA_WEBHOOK_SECRET/);
    const cfg = loadConfig(
      tmp(),
      validEnv({ ...base, FIGMA_WEBHOOK_ENABLED: 'true', FIGMA_WEBHOOK_SECRET: 'pass' }),
    );
    expect(cfg.figma?.webhook).toMatchObject({ enabled: true, passcode: 'pass' });
  });

  it('requires the sentinel user id when presence is enabled', () => {
    const base = { FIGMA_TOKEN: 'figd_x', FIGMA_TEAM_ID: '12345' };
    expect(() =>
      loadConfig(tmp(), validEnv({ ...base, FIGMA_PRESENCE_ENABLED: 'true' })),
    ).toThrow(/FIGMA_SENTINEL_USER_ID/);
    const cfg = loadConfig(
      tmp(),
      validEnv({ ...base, FIGMA_PRESENCE_ENABLED: 'true', FIGMA_SENTINEL_USER_ID: 'u9' }),
    );
    expect(cfg.figma?.presence).toMatchObject({ enabled: true, sentinelUserId: 'u9' });
  });

  it('ignores figma secrets in the config file (env-only)', () => {
    const cwd = tmp();
    writeFileSync(
      join(cwd, 'timetracker.config.json'),
      JSON.stringify({
        guildId: SF,
        channels: { goals: SF, summary: SF, ci: SF },
        adminRoleId: SF,
        reportChannelId: SF,
        figma: { token: 'leaked-in-file', teamId: '777', burstGapMin: 20 },
      }),
    );
    // Non-secret figma fields come from the file; the token must NOT.
    expect(() => loadConfig(cwd, { DISCORD_TOKEN: 'tok' })).toThrow(/FIGMA_TOKEN/);
    const cfg = loadConfig(cwd, { DISCORD_TOKEN: 'tok', FIGMA_TOKEN: 'figd_env' });
    expect(cfg.figma?.token).toBe('figd_env');
    expect(cfg.figma?.teamId).toBe('777');
    expect(cfg.figma?.burstGapMin).toBe(20);
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
