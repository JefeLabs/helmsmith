import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Root Brand Primitives ──────────────────────────────────────────
// These three values drive all branding. The rebrand script updates them.

/** Umbrella suite/org name (e.g., helmsmith → ~/.helmsmith/). */
export const APP_GROUP_NAME = 'helmsmith';

/** Short initials for command paths (e.g., ax → .claude/commands/ax/). */
export const APP_GROUP_INITIALS = 'ax';

/** This tool's name (CLI command, config subdir, manifest filename). */
export const APP_NAME = 'gittyup';

// ─── Derived CLI metadata ────────────────────────────────────────

/** CLI binary name: helmsmith-gittyup */
export const CLI_BIN_NAME = `${APP_GROUP_NAME}-${APP_NAME}`;

// ─── Derived Brand Constants ────────────────────────────────────────

/** Parent directory under $HOME for config/cache/auth: .helmsmith */
export const CONFIG_PARENT_DIR = `.${APP_GROUP_NAME}`;

/** Subdirectory under CONFIG_PARENT_DIR for this tool: gittyup */
export const CONFIG_DIR_NAME = APP_NAME;

/** GitHub repository URL (PR footer, docs). */
export const APP_REPO_URL = `https://github.com/JefeLabs/helmsmith/tree/main/apps/${APP_NAME}`;

// ─── Derived Values ─────────────────────────────────────────────────

/** Manifest filename: gittyup.yaml */
export const MANIFEST_FILENAME = `${APP_NAME}.yaml`;

/** Config directory: ~/.helmsmith/gittyup */
export const APP_CONFIG_DIR = join(homedir(), CONFIG_PARENT_DIR, CONFIG_DIR_NAME);

/** Auth file: ~/.helmsmith/gittyup/auth.json */
export const APP_AUTH_FILE = join(APP_CONFIG_DIR, 'auth.json');

/** Cache directory: ~/.helmsmith/gittyup/cache */
export const APP_CACHE_DIR = join(APP_CONFIG_DIR, 'cache');

/** Human-readable config dir path for messages (uses ~ instead of absolute path). */
export const APP_CONFIG_DIR_DISPLAY = `~/${CONFIG_PARENT_DIR}/${CONFIG_DIR_NAME}`;

/** Environment variable for overriding config root. */
export const ENV_CONFIG_OVERRIDE = `${APP_GROUP_NAME.toUpperCase()}_HOME`;
