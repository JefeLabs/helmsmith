import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Expand a leading `~` to the user's home directory.
 */
export function expandTilde(filepath: string): string {
  if (filepath === '~') {
    return homedir();
  }
  if (filepath.startsWith('~/')) {
    return join(homedir(), filepath.slice(2));
  }
  return filepath;
}

/**
 * Root config directory: ~/.agentx/gitradar/
 *
 * Override with GITRADAR_HOME to relocate config, data, and cache together —
 * used by tests and sandboxes so they never touch the real store.
 */
export function getConfigDir(): string {
  const override = process.env.GITRADAR_HOME;
  if (override) return override;
  return join(homedir(), '.agentx', 'gitradar');
}

/**
 * Data directory: ~/.agentx/gitradar/data/
 */
export function getDataDir(): string {
  return join(getConfigDir(), 'data');
}

/**
 * Config file path: ~/.agentx/gitradar/config.yml
 */
export function getConfigPath(): string {
  return join(getConfigDir(), 'config.yml');
}

/**
 * Cache directory for raw API responses: ~/.agentx/gitradar/cache/
 */
export function getCacheDir(): string {
  return join(getConfigDir(), 'cache');
}

/**
 * Ensure the data directory (and all parents) exist.
 */
export async function ensureDataDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}
