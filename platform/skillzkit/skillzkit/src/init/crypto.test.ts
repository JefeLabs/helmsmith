import { describe, expect, it } from 'vitest';
import type { ScryptParams } from './config.js';
import { decryptApiKey, encryptApiKey, maskApiKey } from './crypto.js';

/**
 * Tests use lower KDF params (N=1024 vs production N=32768) so each
 * scrypt call takes ~3ms instead of ~100ms — the suite runs fast
 * without sacrificing correctness coverage. Production code uses
 * DEFAULT_KDF_PARAMS via the no-override path.
 */
const TEST_PARAMS: ScryptParams = { N: 1024, r: 8, p: 1 };

describe('encryptApiKey + decryptApiKey', () => {
  it('round-trips the API key with correct credentials', () => {
    const blob = encryptApiKey({
      email: 'alice@example.com',
      pin: '123456',
      apiKey: 'skz_live_abc123def456',
      kdfParams: TEST_PARAMS,
    });
    const recovered = decryptApiKey({
      email: 'alice@example.com',
      pin: '123456',
      encrypted: blob,
    });
    expect(recovered).toBe('skz_live_abc123def456');
  });

  it('produces different ciphertext on each encryption (random salt+iv)', () => {
    const a = encryptApiKey({
      email: 'a@b.c',
      pin: 'abcdef',
      apiKey: 'secret',
      kdfParams: TEST_PARAMS,
    });
    const b = encryptApiKey({
      email: 'a@b.c',
      pin: 'abcdef',
      apiKey: 'secret',
      kdfParams: TEST_PARAMS,
    });
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });

  it('rejects decryption with wrong PIN', () => {
    const blob = encryptApiKey({
      email: 'a@b.c',
      pin: 'correct-pin',
      apiKey: 'secret',
      kdfParams: TEST_PARAMS,
    });
    expect(() =>
      decryptApiKey({
        email: 'a@b.c',
        pin: 'wrong-pin',
        encrypted: blob,
      }),
    ).toThrow(/Could not decrypt/);
  });

  it('rejects decryption with wrong email (email is part of the passphrase)', () => {
    const blob = encryptApiKey({
      email: 'alice@example.com',
      pin: '123456',
      apiKey: 'secret',
      kdfParams: TEST_PARAMS,
    });
    expect(() =>
      decryptApiKey({
        email: 'bob@example.com',
        pin: '123456',
        encrypted: blob,
      }),
    ).toThrow(/Could not decrypt/);
  });

  it('rejects decryption when ciphertext has been tampered', () => {
    const blob = encryptApiKey({
      email: 'a@b.c',
      pin: '123456',
      apiKey: 'secret',
      kdfParams: TEST_PARAMS,
    });
    // Flip a byte in the ciphertext
    const tampered = Buffer.from(blob.ciphertext, 'base64');
    tampered[0] ^= 0x01;
    expect(() =>
      decryptApiKey({
        email: 'a@b.c',
        pin: '123456',
        encrypted: { ...blob, ciphertext: tampered.toString('base64') },
      }),
    ).toThrow(/Could not decrypt/);
  });

  it('rejects decryption when authTag has been tampered', () => {
    const blob = encryptApiKey({
      email: 'a@b.c',
      pin: '123456',
      apiKey: 'secret',
      kdfParams: TEST_PARAMS,
    });
    const tampered = Buffer.from(blob.authTag, 'base64');
    tampered[0] ^= 0x01;
    expect(() =>
      decryptApiKey({
        email: 'a@b.c',
        pin: '123456',
        encrypted: { ...blob, authTag: tampered.toString('base64') },
      }),
    ).toThrow(/Could not decrypt/);
  });

  it('handles long API keys', () => {
    const longKey = `skz_live_${'x'.repeat(256)}`;
    const blob = encryptApiKey({
      email: 'a@b.c',
      pin: '123456',
      apiKey: longKey,
      kdfParams: TEST_PARAMS,
    });
    const recovered = decryptApiKey({
      email: 'a@b.c',
      pin: '123456',
      encrypted: blob,
    });
    expect(recovered).toBe(longKey);
  });

  it('rejects malformed base64 in encrypted blob', () => {
    const blob = encryptApiKey({
      email: 'a@b.c',
      pin: '123456',
      apiKey: 'secret',
      kdfParams: TEST_PARAMS,
    });
    // Use control characters that base64 can't decode
    expect(() =>
      decryptApiKey({
        email: 'a@b.c',
        pin: '123456',
        encrypted: { ...blob, ciphertext: '***not base64***' },
      }),
    ).toThrow();
  });
});

describe('maskApiKey', () => {
  it('prefers a 4-digit window when present at end of key', () => {
    expect(maskApiKey('skz_live_xa3F5b8c1234')).toBe('...1234');
  });

  it('prefers the rightmost 4-digit window over alphanumeric tail', () => {
    expect(maskApiKey('skz_4392_xab8c')).toBe('...4392');
  });

  it('picks rightmost 4-digit window when multiple exist', () => {
    expect(maskApiKey('1111_xyz_2222_abc_3333')).toBe('...3333');
  });

  it('falls back to last 4 chars when no 4-digit window exists', () => {
    expect(maskApiKey('skz_live_abcdefXYZ')).toBe('...fXYZ');
  });

  it('handles keys shorter than 4 chars without crashing', () => {
    expect(maskApiKey('xyz')).toBe('...xyz');
    expect(maskApiKey('a')).toBe('...a');
  });

  it('returns ... for empty key (degenerate)', () => {
    expect(maskApiKey('')).toBe('...');
  });
});
