/**
 * API key encryption for skillzkit team-mode config.
 *
 * The API key is encrypted at rest using a passphrase derived from
 * `${email}:${pin}`. On disk, only the encrypted blob (ciphertext + iv
 * + authTag + salt + KDF params) is stored — never the plaintext key,
 * never the PIN. On every contribution POST the user re-enters their
 * PIN; the email is read from config; we re-derive the symmetric key,
 * decrypt, send the plaintext key in the Authorization header, and
 * discard it from memory immediately.
 *
 * Threat model defended: a leaked config.json is not sufficient to
 * use the API key. The attacker also needs the user's PIN. (The email
 * is not a secret — it's stored plaintext alongside the blob.)
 *
 * Crypto choices:
 *   - scrypt(N=2^15, r=8, p=1) — OWASP-acceptable KDF, native to Node
 *     (zero deps), tunable cost (~100ms on a 2024 laptop). Stored
 *     params travel with the blob so we can rotate parameters in
 *     future configs without breaking older ones.
 *   - AES-256-GCM — authenticated encryption. The 16-byte authTag
 *     verifies both confidentiality and integrity; a wrong PIN fails
 *     the authTag check, surfacing as "decrypt error" rather than
 *     silently returning garbage.
 *
 * The round-trip self-test in encryptApiKey() catches whole classes
 * of crypto-pipeline bugs (cipher-mode mismatch, encoding errors,
 * IV/salt swap) at encrypt time rather than weeks later when the
 * user can't decrypt their config.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import type { EncryptedBlob, ScryptParams } from './config.js';

/** Default KDF parameters for new configs. Stored params from older
 *  blobs are honored on decrypt regardless of these defaults. */
export const DEFAULT_KDF_PARAMS: ScryptParams = { N: 1 << 15, r: 8, p: 1 };

const SALT_BYTES = 16;
const IV_BYTES = 12; // GCM standard IV size
const KEY_BYTES = 32; // AES-256

export interface EncryptInput {
  email: string;
  pin: string;
  apiKey: string;
  /** Override KDF params for tests. Production uses DEFAULT_KDF_PARAMS. */
  kdfParams?: ScryptParams;
}

export interface DecryptInput {
  email: string;
  pin: string;
  encrypted: EncryptedBlob;
}

/**
 * Encrypt the API key with a key derived from email + PIN. Performs a
 * round-trip self-test before returning, so any inconsistency between
 * encrypt and decrypt code paths fails loudly here rather than at
 * future contribution time.
 */
export function encryptApiKey(input: EncryptInput): EncryptedBlob {
  const params = input.kdfParams ?? DEFAULT_KDF_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(input.email, input.pin, salt, params);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(input.apiKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const blob: EncryptedBlob = {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
    kdf: 'scrypt',
    kdfParams: { ...params },
  };

  // Round-trip self-test: re-derive the key from the same inputs and
  // confirm decrypt returns the original. A mismatch means the
  // pipeline has a bug — better to know now than at contribution time
  // when the user can't unlock their key.
  const verify = decryptApiKey({
    email: input.email,
    pin: input.pin,
    encrypted: blob,
  });
  if (verify !== input.apiKey) {
    throw new Error(
      'Internal error: encryption self-test failed — round-trip did not return the original key. This is a bug in the crypto pipeline.',
    );
  }

  return blob;
}

/**
 * Decrypt the API key. Throws "Could not decrypt..." on any failure
 * (wrong PIN, wrong email, tampered blob, malformed base64). The
 * caller should map this to a user-facing "wrong PIN" message —
 * AES-GCM doesn't distinguish "wrong key" from "tampered ciphertext"
 * because they're the same operation.
 */
export function decryptApiKey(input: DecryptInput): string {
  const { encrypted } = input;
  let salt: Buffer;
  let iv: Buffer;
  let authTag: Buffer;
  let ciphertext: Buffer;
  try {
    salt = Buffer.from(encrypted.salt, 'base64');
    iv = Buffer.from(encrypted.iv, 'base64');
    authTag = Buffer.from(encrypted.authTag, 'base64');
    ciphertext = Buffer.from(encrypted.ciphertext, 'base64');
  } catch {
    throw new Error('Encrypted blob has malformed base64 fields');
  }

  const key = deriveKey(input.email, input.pin, salt, encrypted.kdfParams);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new Error('Could not decrypt API key — wrong PIN, or the config has been tampered with');
  }
}

/**
 * Build a masked display version of the API key. Prefers a 4-digit
 * window scanned from the rightmost position of the key (per the
 * "ideally being numbers" preference — digits are easier to read and
 * recognize than mixed alphanumerics). Falls back to the last 4
 * characters of any kind if no 4-digit window exists.
 *
 * Examples:
 *   maskApiKey("skz_live_xa3F5b8c1234")  → "...1234"
 *   maskApiKey("skz_4392_xab8c")         → "...4392"  (rightmost digit window wins over alphanumeric tail)
 *   maskApiKey("skz_live_abcdefXYZ")     → "...dXYZ"  (no digit window — fallback)
 *   maskApiKey("xyz")                    → "...xyz"   (shorter than 4 — show what we have)
 */
export function maskApiKey(key: string): string {
  if (key.length === 0) return '...';
  // Scan for a 4-character window where every char is a digit. Walk
  // from rightmost to leftmost so we prefer trailing numeric runs
  // (which feel more natural to identify by, e.g. AWS access key IDs).
  for (let i = key.length - 4; i >= 0; i--) {
    const window = key.slice(i, i + 4);
    if (/^\d{4}$/.test(window)) {
      return `...${window}`;
    }
  }
  return `...${key.slice(-4)}`;
}

/* ── internal ──────────────────────────────────────────────────── */

/**
 * Derive a 32-byte AES key from the email + PIN passphrase.
 *
 * Passphrase format is `${email}:${pin}` with an explicit colon
 * delimiter. Without the delimiter, ("alice@", "bob:1234") could
 * collide with ("alice", "@bob:1234") — a boundary attack. A single
 * colon is sufficient because email local-parts can't contain a
 * literal unquoted colon.
 *
 * `maxmem` is set generously above scrypt's actual memory need
 * (128 * N * r * 2) so Node doesn't reject larger N values when
 * users tune for stronger KDF.
 */
function deriveKey(email: string, pin: string, salt: Buffer, params: ScryptParams): Buffer {
  const passphrase = `${email}:${pin}`;
  return scryptSync(passphrase, salt, KEY_BYTES, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.N * params.r * 2,
  });
}
