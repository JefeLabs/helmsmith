import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  CONFIG_PARENT_DIR,
  CONFIG_DIR_NAME,
  ENV_CONFIG_OVERRIDE,
} from '../config/branding.js';
import type { ProjectLocation } from './location.js';
import { getRepoTaskmasterHome } from './git.js';

/**
 * Returns the root config directory (e.g. ~/.agentx).
 * Respects the AGENTX_HOME env var override.
 */
export function getConfigRoot(): string {
  return process.env[ENV_CONFIG_OVERRIDE] ?? join(homedir(), CONFIG_PARENT_DIR);
}

/**
 * Returns the global (home) tool-specific home directory path.
 * e.g. ~/.agentx/taskmaster/
 */
export function getTaskmasterHome(): string {
  return join(getConfigRoot(), CONFIG_DIR_NAME);
}

/**
 * Returns the taskmaster home for a given location.
 * - 'home' → ~/.agentx/taskmaster/
 * - 'repo' → {gitRoot}/.agentx/taskmaster/
 */
export function getTaskmasterHomeFor(location: ProjectLocation, gitRoot?: string | null): string {
  if (location === 'repo') {
    if (!gitRoot) {
      throw new Error('gitRoot is required for repo-local projects');
    }
    return getRepoTaskmasterHome(gitRoot);
  }
  return getTaskmasterHome();
}

/**
 * Returns the path for a specific project directory.
 * Location-aware: routes to home or repo-local storage.
 */
export function getProjectDir(name: string, location: ProjectLocation = 'home', gitRoot?: string | null): string {
  return join(getTaskmasterHomeFor(location, gitRoot), name);
}

/**
 * Returns the path to a specific file within the global tool home directory.
 */
export function getHomePath(filename: string): string {
  return join(getTaskmasterHome(), filename);
}

/**
 * Bootstrap the global home directory structure.
 * Creates the tool config directory if it doesn't exist.
 * Returns true if newly created, false if already existed.
 */
export async function bootstrapHome(): Promise<boolean> {
  const home = getTaskmasterHome();
  const existed = existsSync(home);

  if (!existed) {
    await mkdir(home, { recursive: true });
  }

  return !existed;
}

/**
 * Bootstrap the repo-local home directory.
 * Creates {gitRoot}/.agentx/taskmaster/ if it doesn't exist.
 * Returns true if newly created.
 */
export async function bootstrapRepoHome(gitRoot: string): Promise<boolean> {
  const repoHome = getRepoTaskmasterHome(gitRoot);
  const existed = existsSync(repoHome);

  if (!existed) {
    await mkdir(repoHome, { recursive: true });
  }

  return !existed;
}

/**
 * Check if the global home directory exists.
 */
export function homeExists(): boolean {
  return existsSync(getTaskmasterHome());
}

/**
 * Scaffold per-project directory structure:
 * <project>/tasks.json, config.yaml, tasks/, templates/, docs/
 */
export async function scaffoldProjectDir(name: string, location: ProjectLocation = 'home', gitRoot?: string | null): Promise<void> {
  const projectDir = getProjectDir(name, location, gitRoot);

  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, 'tasks'), { recursive: true });
  await mkdir(join(projectDir, 'templates'), { recursive: true });
  await mkdir(join(projectDir, 'docs'), { recursive: true });
}
