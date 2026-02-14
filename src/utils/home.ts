import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_USERDATA = join(homedir(), '.agentx-userdata');
const TASKMASTER_DIR = 'taskmaster';

/**
 * Returns the root agentx-userdata directory.
 * Respects the AGENTX_USERDATA env var override.
 */
export function getUserdataRoot(): string {
  return process.env.AGENTX_USERDATA ?? DEFAULT_USERDATA;
}

/**
 * Returns the taskmaster home directory path.
 * e.g. ~/.agentx-userdata/taskmaster/
 */
export function getTaskmasterHome(): string {
  return join(getUserdataRoot(), TASKMASTER_DIR);
}

/**
 * Returns the path for a specific project directory.
 */
export function getProjectDir(projectName: string): string {
  return join(getTaskmasterHome(), projectName);
}

/**
 * Returns the path to a specific file within the taskmaster home.
 */
export function getHomePath(filename: string): string {
  return join(getTaskmasterHome(), filename);
}

/**
 * Bootstrap the global home directory structure.
 * Creates ~/.agentx-userdata/taskmaster/ if it doesn't exist.
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
 * Check if the global home directory exists.
 */
export function homeExists(): boolean {
  return existsSync(getTaskmasterHome());
}

/**
 * Scaffold per-project directory structure:
 * <project>/tasks.json, config.yaml, tasks/, templates/, docs/
 */
export async function scaffoldProjectDir(projectName: string): Promise<void> {
  const projectDir = getProjectDir(projectName);

  await mkdir(projectDir, { recursive: true });
  await mkdir(join(projectDir, 'tasks'), { recursive: true });
  await mkdir(join(projectDir, 'templates'), { recursive: true });
  await mkdir(join(projectDir, 'docs'), { recursive: true });
}
