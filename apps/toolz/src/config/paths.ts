/**
 * Resolve the directory and file paths ToolZ uses for persistent
 * state. Defaults to `~/.agentx/toolz/`, overridable via the
 * `AGENTX_TOOLZ_DIR` env var (used by tests for isolation, and by CI
 * to keep state per-run).
 *
 * Cross-platform: `os.homedir()` resolves correctly on macOS, Linux,
 * Windows, and WSL — no Windows-specific %APPDATA% mapping needed
 * since we target a dotted directory under home, which works
 * everywhere.
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Resolve the ToolZ root directory — env override or `~/.agentx/toolz/`. */
export function getToolzDir(): string {
  const override = process.env.AGENTX_TOOLZ_DIR;
  if (override) return override;
  return join(homedir(), '.agentx', 'toolz');
}

/** Path to the registry YAML — installed tools + metadata. */
export function getRegistryPath(): string {
  return join(getToolzDir(), 'registry.yaml');
}

/** Path to the user-extension catalog YAML — merges with built-in. */
export function getUserCatalogPath(): string {
  return join(getToolzDir(), 'catalog.yaml');
}

/**
 * Ensure the ToolZ root directory exists. Idempotent. Called before
 * any registry write — read-only consumers don't need to call this.
 */
export function ensureToolzDir(): void {
  mkdirSync(getToolzDir(), { recursive: true });
}
