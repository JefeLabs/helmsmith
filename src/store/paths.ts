import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Expand a leading `~` to the user's home directory.
 */
export function expandTilde(filepath: string): string {
  if (filepath === "~") {
    return homedir();
  }
  if (filepath.startsWith("~/")) {
    return join(homedir(), filepath.slice(2));
  }
  return filepath;
}

/**
 * Root config directory: ~/.agentx/gitradar/
 */
export function getConfigDir(): string {
  return join(homedir(), ".agentx", "gitradar");
}

/**
 * Data directory: ~/.agentx/gitradar/data/
 */
export function getDataDir(): string {
  return join(getConfigDir(), "data");
}

/**
 * Config file path: ~/.agentx/gitradar/config.yml
 */
export function getConfigPath(): string {
  return join(getConfigDir(), "config.yml");
}

/**
 * Commits data file path: ~/.agentx/gitradar/data/commits-by-filetype.json
 */
export function getCommitsPath(): string {
  return join(getDataDir(), "commits-by-filetype.json");
}

/**
 * Scan state file path: ~/.agentx/gitradar/data/scan-state.json
 */
export function getScanStatePath(): string {
  return join(getDataDir(), "scan-state.json");
}

/**
 * Author registry file path: ~/.agentx/gitradar/data/authors.json
 */
export function getAuthorRegistryPath(): string {
  return join(getDataDir(), "authors.json");
}

/**
 * Ensure the data directory (and all parents) exist.
 */
export async function ensureDataDir(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}
