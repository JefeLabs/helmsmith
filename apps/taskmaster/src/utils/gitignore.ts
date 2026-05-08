import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_PARENT_DIR } from '../config/branding.js';

const GITIGNORE_ENTRY = `${CONFIG_PARENT_DIR}/`;

/**
 * Ensure .gitignore contains an entry for the config directory.
 * Creates .gitignore if it doesn't exist.
 * Returns true if an entry was added, false if already present.
 */
export async function ensureGitignoreEntry(gitRoot: string): Promise<boolean> {
  const gitignorePath = join(gitRoot, '.gitignore');

  let content = '';
  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, 'utf-8');
  }

  // Check if already present (exact line match)
  const lines = content.split('\n');
  if (lines.some((line) => line.trim() === GITIGNORE_ENTRY)) {
    return false;
  }

  // Append with a newline separator if needed
  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await writeFile(gitignorePath, `${content}${separator}${GITIGNORE_ENTRY}\n`, 'utf-8');
  return true;
}
