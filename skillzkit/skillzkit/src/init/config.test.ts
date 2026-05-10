import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configExists,
  configPath,
  readConfig,
  type SkillzkitConfig,
  tryReadConfig,
  validateConfig,
  writeConfig,
} from './config.js';

/**
 * Each test gets its own temp directory pointed at by SKILLZKIT_CONFIG
 * so writes don't pollute the user's real config and tests don't see
 * each other's state.
 */
let tempDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'skillzkit-config-test-'));
  prevEnv = process.env.SKILLZKIT_CONFIG;
  process.env.SKILLZKIT_CONFIG = join(tempDir, 'config.json');
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.SKILLZKIT_CONFIG;
  else process.env.SKILLZKIT_CONFIG = prevEnv;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('configPath', () => {
  it('honors SKILLZKIT_CONFIG env var', () => {
    expect(configPath()).toBe(process.env.SKILLZKIT_CONFIG);
  });
});

describe('configExists / tryReadConfig', () => {
  it('reports missing config gracefully', () => {
    expect(configExists()).toBe(false);
    expect(tryReadConfig()).toBe(null);
  });

  it('readConfig throws with a helpful message when missing', () => {
    expect(() => readConfig()).toThrow(/No skillzkit config found/);
  });
});

describe('writeConfig + readConfig round-trip', () => {
  it('preserves a standalone config', () => {
    const original: SkillzkitConfig = {
      version: 1,
      mode: 'standalone',
      email: 'alice@example.com',
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z',
    };
    writeConfig(original);
    const loaded = readConfig();
    expect(loaded.mode).toBe('standalone');
    expect(loaded.email).toBe('alice@example.com');
    // updatedAt is re-stamped on every write, so just sanity check it parses
    expect(new Date(loaded.updatedAt).toString()).not.toBe('Invalid Date');
  });

  it('preserves a team config including encrypted blob', () => {
    const original: SkillzkitConfig = {
      version: 1,
      mode: 'team',
      email: 'bob@example.com',
      team: {
        apiUrl: 'https://skillz.example.com',
        keyMasked: '...4f92',
        keyEncrypted: {
          ciphertext: 'Y2lwaGVy',
          iv: 'aXY=',
          authTag: 'dGFn',
          salt: 'c2FsdA==',
          kdf: 'scrypt',
          kdfParams: { N: 32768, r: 8, p: 1 },
        },
      },
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z',
    };
    writeConfig(original);
    const loaded = readConfig();
    expect(loaded.mode).toBe('team');
    if (loaded.mode !== 'team') throw new Error('type narrowing failed');
    expect(loaded.team.apiUrl).toBe('https://skillz.example.com');
    expect(loaded.team.keyEncrypted.kdfParams.N).toBe(32768);
  });

  it('writes the file with mode 0600 (user-only read/write)', () => {
    const original: SkillzkitConfig = {
      version: 1,
      mode: 'standalone',
      email: 'alice@example.com',
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z',
    };
    writeConfig(original);
    const stat = statSync(configPath());
    // mask out file-type bits, keep only permission bits
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('validateConfig', () => {
  it('rejects non-object input', () => {
    expect(() => validateConfig('not an object')).toThrow(/expected JSON object/);
    expect(() => validateConfig(null)).toThrow(/expected JSON object/);
  });

  it('rejects missing or empty email', () => {
    expect(() =>
      validateConfig({
        version: 1,
        mode: 'standalone',
        email: '',
        createdAt: 'x',
        updatedAt: 'x',
      }),
    ).toThrow(/email/);
  });

  it('rejects mode=standalone with team block set', () => {
    expect(() =>
      validateConfig({
        version: 1,
        mode: 'standalone',
        email: 'a@b.c',
        team: { apiUrl: 'https://x' },
        createdAt: 'x',
        updatedAt: 'x',
      }),
    ).toThrow(/standalone configs must not carry team settings/);
  });

  it('rejects mode=team without team block', () => {
    expect(() =>
      validateConfig({
        version: 1,
        mode: 'team',
        email: 'a@b.c',
        createdAt: 'x',
        updatedAt: 'x',
      }),
    ).toThrow(/mode=team requires a `team` object/);
  });

  it('rejects unsupported version (forward compat)', () => {
    expect(() =>
      validateConfig({
        version: 99,
        mode: 'standalone',
        email: 'a@b.c',
        createdAt: 'x',
        updatedAt: 'x',
      }),
    ).toThrow(/unsupported config version/);
  });

  it('rejects encrypted blob with missing fields', () => {
    expect(() =>
      validateConfig({
        version: 1,
        mode: 'team',
        email: 'a@b.c',
        team: {
          apiUrl: 'https://x',
          keyMasked: '...1234',
          keyEncrypted: {
            ciphertext: 'x',
            iv: 'x',
            // authTag missing
            salt: 'x',
            kdf: 'scrypt',
            kdfParams: { N: 32768, r: 8, p: 1 },
          },
        },
        createdAt: 'x',
        updatedAt: 'x',
      }),
    ).toThrow(/authTag/);
  });

  it('rejects unsupported KDF', () => {
    expect(() =>
      validateConfig({
        version: 1,
        mode: 'team',
        email: 'a@b.c',
        team: {
          apiUrl: 'https://x',
          keyMasked: '...1234',
          keyEncrypted: {
            ciphertext: 'x',
            iv: 'x',
            authTag: 'x',
            salt: 'x',
            kdf: 'argon2',
            kdfParams: { N: 32768, r: 8, p: 1 },
          },
        },
        createdAt: 'x',
        updatedAt: 'x',
      }),
    ).toThrow(/kdf.*must be "scrypt"/);
  });
});
