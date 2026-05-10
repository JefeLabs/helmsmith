/**
 * skillzkit user config — schema and filesystem io.
 *
 * Lives at `~/.agentx/skillzkit/config.json` (overridable via the
 * SKILLZKIT_CONFIG env var for tests). Captures the user's choice of
 * standalone vs team mode, their email (for local artifact attribution
 * in both modes; matches controlplane identity in team mode), and the
 * encrypted API key bundle (team mode only).
 *
 * Design notes:
 *
 * - Discriminated union on `mode` enforces the "team requires team
 *   settings" invariant at the type level. Standalone configs cannot
 *   carry team settings; team configs must carry them.
 *
 * - File mode 0600, directory mode 0700 — the dir holds an encrypted
 *   key blob that's only secured by the user's PIN. Tightening
 *   filesystem permissions adds a defense-in-depth layer against
 *   shared-machine snooping (matches ~/.ssh and ~/.aws conventions).
 *
 * - `version: 1` is reserved for forward compatibility. Future
 *   schema changes should bump this and run a migration in
 *   readConfig() rather than break existing configs.
 *
 * - validateConfig() does runtime shape checking because the file is
 *   user-editable and may be hand-modified, restored from backup, or
 *   produced by a future/older skillzkit. Helpful error messages
 *   beat opaque parse failures.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Scrypt KDF parameters bundled with each encrypted blob so we can
 *  rotate them in the future without breaking older configs. The
 *  parser will use whatever params are stored, not the current
 *  defaults. */
export interface ScryptParams {
  /** Cost parameter — must be power of 2. Higher = slower = more brute-force resistant. */
  N: number;
  /** Block size. Standard is 8. */
  r: number;
  /** Parallelism. Standard is 1. */
  p: number;
}

/** AES-256-GCM ciphertext + the parameters needed to decrypt it. All
 *  binary fields are base64-encoded for JSON portability. */
export interface EncryptedBlob {
  /** AES-256-GCM ciphertext, base64. */
  ciphertext: string;
  /** AES-GCM nonce/IV (12 bytes), base64. */
  iv: string;
  /** AES-GCM authentication tag (16 bytes), base64. */
  authTag: string;
  /** Random salt for the KDF (16 bytes), base64. */
  salt: string;
  /** KDF identifier — only "scrypt" supported in v1. */
  kdf: 'scrypt';
  /** Parameters used at encryption time. */
  kdfParams: ScryptParams;
}

export interface TeamSettings {
  /** Base URL of the skillzkit API, e.g. https://skillz.example.com */
  apiUrl: string;
  /** Encrypted API key bundle. Decrypted at POST time with email + PIN. */
  keyEncrypted: EncryptedBlob;
  /** Masked display version of the key (last 4 chars, numeric preferred)
   *  so users can identify which key they're using without decrypting. */
  keyMasked: string;
}

interface BaseConfig {
  version: 1;
  email: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

export interface StandaloneConfig extends BaseConfig {
  mode: 'standalone';
}

export interface TeamConfig extends BaseConfig {
  mode: 'team';
  team: TeamSettings;
}

export type SkillzkitConfig = StandaloneConfig | TeamConfig;

/* ── Path resolution ───────────────────────────────────────────── */

/**
 * Resolve the config file path. Default is
 * `~/.agentx/skillzkit/config.json`. Overridable via the
 * SKILLZKIT_CONFIG env var, which lets tests point at a temp file
 * without polluting the real config directory.
 */
export function configPath(): string {
  if (process.env.SKILLZKIT_CONFIG) return process.env.SKILLZKIT_CONFIG;
  return join(homedir(), '.agentx', 'skillzkit', 'config.json');
}

export function configExists(): boolean {
  return existsSync(configPath());
}

/* ── Read ──────────────────────────────────────────────────────── */

/**
 * Read and validate the config. Throws if missing or malformed —
 * intended for callers that genuinely require a config (e.g., a
 * contribution POST that needs the team block).
 */
export function readConfig(): SkillzkitConfig {
  const path = configPath();
  if (!existsSync(path)) {
    throw new Error(`No skillzkit config found at ${path}. Run \`skillzkit init\` to create one.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `Could not parse ${path} as JSON: ${(err as Error).message}. ` +
        `If the file is corrupted, run \`skillzkit init --force\` to rewrite it.`,
    );
  }
  return validateConfig(raw, path);
}

/**
 * Read the config if present, return null if missing. Use for the
 * "should I run init first?" check at TUI/CLI startup — the absence
 * of a config is normal, not an error.
 */
export function tryReadConfig(): SkillzkitConfig | null {
  if (!configExists()) return null;
  return readConfig();
}

/* ── Write ─────────────────────────────────────────────────────── */

/**
 * Persist the config to disk. mkdir-p the parent directory with mode
 * 0700, write the file with mode 0600. Updates `updatedAt` on every
 * write; preserves `createdAt` if not explicitly set (callers should
 * pass createdAt on first write, then leave it stable).
 */
export function writeConfig(config: SkillzkitConfig): void {
  const path = configPath();
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }
  // Always re-stamp updatedAt at write time so consumers can trust it.
  // createdAt is the caller's responsibility on first write.
  const stamped: SkillzkitConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(stamped, null, 2)}\n`, {
    mode: 0o600,
  });
}

/* ── Validation ────────────────────────────────────────────────── */

/**
 * Validate raw JSON-parsed input against the SkillzkitConfig schema.
 * Errors include the offending path so user can fix their file by
 * hand if something is missing.
 */
export function validateConfig(raw: unknown, source = '<input>'): SkillzkitConfig {
  if (!isPlainObject(raw)) {
    throw configError(source, 'expected JSON object at top level');
  }
  if (raw.version !== 1) {
    throw configError(
      source,
      `unsupported config version: ${JSON.stringify(raw.version)} (expected 1)`,
    );
  }
  const email = raw.email;
  if (typeof email !== 'string' || email.length === 0) {
    throw configError(source, `missing or empty \`email\``);
  }
  const createdAt = raw.createdAt;
  const updatedAt = raw.updatedAt;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') {
    throw configError(source, `\`createdAt\` and \`updatedAt\` must be ISO strings`);
  }

  if (raw.mode === 'standalone') {
    if ('team' in raw && raw.team !== undefined) {
      throw configError(
        source,
        `mode=standalone but \`team\` is set — standalone configs must not carry team settings`,
      );
    }
    return { version: 1, mode: 'standalone', email, createdAt, updatedAt };
  }

  if (raw.mode === 'team') {
    const team = validateTeamSettings(raw.team, source);
    return {
      version: 1,
      mode: 'team',
      email,
      team,
      createdAt,
      updatedAt,
    };
  }

  throw configError(
    source,
    `\`mode\` must be "standalone" or "team", got ${JSON.stringify(raw.mode)}`,
  );
}

function validateTeamSettings(raw: unknown, source: string): TeamSettings {
  if (!isPlainObject(raw)) {
    throw configError(source, `mode=team requires a \`team\` object`);
  }
  if (typeof raw.apiUrl !== 'string' || raw.apiUrl.length === 0) {
    throw configError(source, `\`team.apiUrl\` must be a non-empty string`);
  }
  if (typeof raw.keyMasked !== 'string' || raw.keyMasked.length === 0) {
    throw configError(source, `\`team.keyMasked\` must be a non-empty string`);
  }
  const blob = validateEncryptedBlob(raw.keyEncrypted, source);
  return { apiUrl: raw.apiUrl, keyMasked: raw.keyMasked, keyEncrypted: blob };
}

function validateEncryptedBlob(raw: unknown, source: string): EncryptedBlob {
  if (!isPlainObject(raw)) {
    throw configError(source, `\`team.keyEncrypted\` must be an object`);
  }
  for (const field of ['ciphertext', 'iv', 'authTag', 'salt'] as const) {
    if (typeof raw[field] !== 'string') {
      throw configError(source, `\`team.keyEncrypted.${field}\` must be base64 string`);
    }
  }
  if (raw.kdf !== 'scrypt') {
    throw configError(
      source,
      `\`team.keyEncrypted.kdf\` must be "scrypt", got ${JSON.stringify(raw.kdf)}`,
    );
  }
  const params = raw.kdfParams;
  if (!isPlainObject(params)) {
    throw configError(source, `\`team.keyEncrypted.kdfParams\` must be an object`);
  }
  for (const field of ['N', 'r', 'p'] as const) {
    if (typeof params[field] !== 'number' || !Number.isInteger(params[field])) {
      throw configError(source, `\`team.keyEncrypted.kdfParams.${field}\` must be an integer`);
    }
  }
  return {
    ciphertext: raw.ciphertext as string,
    iv: raw.iv as string,
    authTag: raw.authTag as string,
    salt: raw.salt as string,
    kdf: 'scrypt',
    kdfParams: {
      N: params.N as number,
      r: params.r as number,
      p: params.p as number,
    },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function configError(source: string, message: string): Error {
  return new Error(`Invalid skillzkit config at ${source}: ${message}`);
}
