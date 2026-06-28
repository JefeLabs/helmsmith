/**
 * Centralized brand constants — the ONLY file with hardcoded brand strings.
 * Everything else in the codebase imports from here.
 *
 * To rebrand: edit branding.yaml at project root, then run `taskmaster rebrand`.
 */

// ── Three root primitives ────────────────────────────────────
export const APP_GROUP_NAME = 'agentx';
export const APP_GROUP_INITIALS = 'ax';
export const APP_NAME = 'taskmaster';

// ── Derived CLI metadata ────────────────────────────────────
export const CLI_BIN_NAME = APP_NAME;
export const CLI_DESCRIPTION =
  'CLI-based project task generator with complexity scoring and auto-decomposition';
export const CLI_VERSION = '0.1.0';

// ── Derived config path fragments ───────────────────────────
export const CONFIG_PARENT_DIR = `.${APP_GROUP_NAME}`;
export const CONFIG_DIR_NAME = APP_NAME;
export const MANIFEST_FILENAME = `${APP_NAME}.yaml`;

// ── Display path for user-facing messages (not for fs ops) ──
export const APP_CONFIG_DIR_DISPLAY = `~/${CONFIG_PARENT_DIR}/${CONFIG_DIR_NAME}`;
export const APP_REPO_CONFIG_DIR_DISPLAY = `<repo>/${CONFIG_PARENT_DIR}/${CONFIG_DIR_NAME}`;

// ── Environment variable for overriding config root ─────────
export const ENV_CONFIG_OVERRIDE = `${APP_GROUP_NAME.toUpperCase()}_HOME`;
