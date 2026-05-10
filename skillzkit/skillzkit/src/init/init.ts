/**
 * Init orchestrator — converts user-supplied input (CLI args or
 * interactive prompt answers) into a SkillzkitConfig and writes it.
 *
 * Split from the CLI command so:
 *   1. The TUI's first-run flow can call the same logic with its own
 *      prompt rendering (task #6).
 *   2. The orchestrator is testable as a pure function — pass opts in,
 *      get config out, no readline mocking required.
 *
 * Sequencing inside runInit():
 *   1. Validate every field. Bail fast on bad input — partial writes
 *      to ~/.agentx/skillzkit/config.json would leave the user in a
 *      half-initialized state.
 *   2. For team mode, encrypt the API key. The crypto module's
 *      built-in round-trip self-test catches any pipeline bug here
 *      rather than at first contribution time.
 *   3. Build the config object, write it. writeConfig() handles
 *      mkdir-p, file mode 0600, and updatedAt stamping.
 */

import type { SkillzkitConfig } from './config.js';
import { configExists, configPath, writeConfig } from './config.js';
import { encryptApiKey, maskApiKey } from './crypto.js';

export interface InitOptions {
  mode: 'standalone' | 'team';
  email: string;
  /** Required when mode === "team". */
  apiUrl?: string;
  /** Required when mode === "team". Plaintext at this layer; encrypted
   *  before being written to disk. */
  apiKey?: string;
  /** Required when mode === "team". Used as part of the
   *  encryption passphrase along with email. */
  pin?: string;
  /** When true, overwrite an existing config. Default: refuse if config exists. */
  force?: boolean;
}

export interface InitResult {
  config: SkillzkitConfig;
  /** Path the config was written to — useful for "next steps" messaging. */
  path: string;
  /** True when an existing config was overwritten. */
  overwrote: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PIN_LENGTH = 6;

export function validateInitOptions(opts: InitOptions): void {
  if (!EMAIL_REGEX.test(opts.email)) {
    throw new Error(`Invalid email "${opts.email}" — must look like name@example.com`);
  }
  if (opts.mode !== 'standalone' && opts.mode !== 'team') {
    throw new Error(`Invalid mode "${opts.mode}" — must be "standalone" or "team"`);
  }
  if (opts.mode === 'team') {
    if (!opts.apiUrl) {
      throw new Error(`Team mode requires --api-url`);
    }
    try {
      new URL(opts.apiUrl);
    } catch {
      throw new Error(`Invalid --api-url "${opts.apiUrl}" — must be a valid URL`);
    }
    if (!opts.apiKey || opts.apiKey.trim().length === 0) {
      throw new Error(`Team mode requires --api-key (cannot be empty)`);
    }
    if (!opts.pin || opts.pin.length < MIN_PIN_LENGTH) {
      throw new Error(`Team mode requires --pin of at least ${MIN_PIN_LENGTH} characters`);
    }
  }
}

export function runInit(opts: InitOptions): InitResult {
  validateInitOptions(opts);

  const overwrote = configExists();
  if (overwrote && !opts.force) {
    throw new Error(
      `Config already exists at ${configPath()}. Pass --force to overwrite, ` +
        `or use \`skillzkit config\` to view/edit individual fields.`,
    );
  }

  const now = new Date().toISOString();
  let config: SkillzkitConfig;

  if (opts.mode === 'standalone') {
    config = {
      version: 1,
      mode: 'standalone',
      email: opts.email,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    // Team mode — required-field guarantees come from validateInitOptions
    // above, but TypeScript can't narrow that, so re-check non-null.
    if (!opts.apiUrl || !opts.apiKey || !opts.pin) {
      throw new Error('internal: team-mode fields missing after validation');
    }
    const keyEncrypted = encryptApiKey({
      email: opts.email,
      pin: opts.pin,
      apiKey: opts.apiKey,
    });
    config = {
      version: 1,
      mode: 'team',
      email: opts.email,
      team: {
        apiUrl: opts.apiUrl,
        keyEncrypted,
        keyMasked: maskApiKey(opts.apiKey),
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  writeConfig(config);
  return { config, path: configPath(), overwrote };
}
