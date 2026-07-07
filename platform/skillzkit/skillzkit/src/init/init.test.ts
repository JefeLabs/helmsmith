import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit, validateInitOptions } from './init.js';

let tempDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'skillzkit-init-test-'));
  prevEnv = process.env.SKILLZKIT_CONFIG;
  process.env.SKILLZKIT_CONFIG = join(tempDir, 'config.json');
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.SKILLZKIT_CONFIG;
  else process.env.SKILLZKIT_CONFIG = prevEnv;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runInit — happy paths', () => {
  it('writes a standalone config with mode + email only', () => {
    const result = runInit({
      mode: 'standalone',
      email: 'alice@example.com',
    });
    expect(result.overwrote).toBe(false);
    expect(result.config.mode).toBe('standalone');
    expect(result.config.email).toBe('alice@example.com');
    if (result.config.mode === 'standalone') {
      expect('team' in result.config).toBe(false);
    }
  });

  it('writes a team config with encrypted key and masked display', () => {
    const result = runInit({
      mode: 'team',
      email: 'bob@example.com',
      apiUrl: 'https://skillz.example.com',
      apiKey: 'skz_live_xa3F5b8c1234',
      pin: 'secret-pin-123',
    });
    expect(result.config.mode).toBe('team');
    if (result.config.mode !== 'team') throw new Error('type narrow failed');
    expect(result.config.team.apiUrl).toBe('https://skillz.example.com');
    expect(result.config.team.keyMasked).toBe('...1234');

    // Encrypted blob should NOT contain the plaintext key anywhere.
    const onDisk = readFileSync(process.env.SKILLZKIT_CONFIG!, 'utf8');
    expect(onDisk).not.toContain('skz_live_xa3F5b8c1234');
    // But the masked version is allowed to appear.
    expect(onDisk).toContain('...1234');
  });
});

describe('runInit — overwrite protection', () => {
  it('refuses to overwrite existing config without --force', () => {
    runInit({ mode: 'standalone', email: 'a@b.c' });
    expect(() => runInit({ mode: 'standalone', email: 'a@b.c' })).toThrow(/Config already exists/);
  });

  it('overwrites when --force is set; reports overwrote=true', () => {
    runInit({ mode: 'standalone', email: 'alice@example.com' });
    const second = runInit({
      mode: 'standalone',
      email: 'bob@example.com',
      force: true,
    });
    expect(second.overwrote).toBe(true);
    expect(second.config.email).toBe('bob@example.com');
  });
});

describe('validateInitOptions', () => {
  it('rejects invalid email', () => {
    expect(() => validateInitOptions({ mode: 'standalone', email: 'not-an-email' })).toThrow(
      /Invalid email/,
    );
  });

  it('rejects invalid mode', () => {
    expect(() => validateInitOptions({ mode: 'neither' as never, email: 'a@b.c' })).toThrow(
      /Invalid mode/,
    );
  });

  it('requires apiUrl when mode=team', () => {
    expect(() =>
      validateInitOptions({
        mode: 'team',
        email: 'a@b.c',
        apiKey: 'k',
        pin: 'abcdef',
      }),
    ).toThrow(/--api-url/);
  });

  it('rejects malformed apiUrl', () => {
    expect(() =>
      validateInitOptions({
        mode: 'team',
        email: 'a@b.c',
        apiUrl: 'not a url',
        apiKey: 'k',
        pin: 'abcdef',
      }),
    ).toThrow(/Invalid --api-url/);
  });

  it('requires non-empty apiKey when mode=team', () => {
    expect(() =>
      validateInitOptions({
        mode: 'team',
        email: 'a@b.c',
        apiUrl: 'https://x',
        apiKey: '',
        pin: 'abcdef',
      }),
    ).toThrow(/--api-key/);
  });

  it('rejects short PIN', () => {
    expect(() =>
      validateInitOptions({
        mode: 'team',
        email: 'a@b.c',
        apiUrl: 'https://x',
        apiKey: 'k',
        pin: '12345', // 5 chars, below the 6-char minimum
      }),
    ).toThrow(/--pin of at least 6 characters/);
  });

  it('accepts standalone with just mode + email', () => {
    expect(() => validateInitOptions({ mode: 'standalone', email: 'a@b.c' })).not.toThrow();
  });

  it('accepts team with all required fields', () => {
    expect(() =>
      validateInitOptions({
        mode: 'team',
        email: 'a@b.c',
        apiUrl: 'https://x.example.com',
        apiKey: 'skz_live_x',
        pin: 'abcdef',
      }),
    ).not.toThrow();
  });
});
