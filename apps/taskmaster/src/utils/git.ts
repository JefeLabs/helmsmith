import { execFile as execFileCb } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CONFIG_DIR_NAME, CONFIG_PARENT_DIR } from '../config/branding.js';

const execFile = promisify(execFileCb);

/**
 * Detect the git repository root for the given directory.
 * Returns null if not inside a git repository.
 */
export async function detectGitRoot(cwd?: string): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--show-toplevel'], {
      cwd: cwd ?? process.cwd(),
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Returns the repo-local taskmaster home directory path.
 * e.g. {gitRoot}/.agentx/taskmaster/
 */
export function getRepoTaskmasterHome(gitRoot: string): string {
  return join(gitRoot, CONFIG_PARENT_DIR, CONFIG_DIR_NAME);
}
