/**
 * Shared shell-out helper for adapters. Uses `execFile` (NOT `exec`)
 * so user-supplied package names cannot be shell-interpreted —
 * arguments pass directly to the binary as argv entries with no shell
 * involvement. Adapters use this instead of touching node:child_process
 * directly so tests can mock it in one place.
 */

import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstallResult } from '../package-managers.js';

const runArgs = promisify(nodeExecFile);

/**
 * Run a command and return an InstallResult. Throws are caught and
 * surfaced as { success: false } with the captured output and error
 * message — adapters never throw to their callers.
 */
export async function runCommand(
  cmd: string,
  args: string[],
  options: { input?: string } = {},
): Promise<InstallResult> {
  try {
    const { stdout, stderr } = await runArgs(cmd, args, {
      maxBuffer: 32 * 1024 * 1024,
      ...(options.input ? { input: options.input } : {}),
    });
    return {
      success: true,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };
    return {
      success: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      error: e.message,
    };
  }
}

/**
 * Lightweight `which`-style check. Returns true when the binary is
 * resolvable on PATH. Used by adapters' isAvailable() to determine
 * whether the package manager itself is installed.
 */
export async function commandExists(name: string): Promise<boolean> {
  const result = await runCommand(process.platform === 'win32' ? 'where' : 'which', [name]);
  return result.success && result.stdout.trim().length > 0;
}

/**
 * Decide whether a package-manager command needs `sudo` prefixing.
 * Returns true when:
 *   - we're on POSIX (sudo concept exists)
 *   - we're not already running as root (uid 0)
 *
 * Adapters that need root (apt, dnf, pacman, apk) call this when
 * building their argv.
 */
export function needsSudo(): boolean {
  if (process.platform === 'win32') return false;
  return process.getuid?.() !== 0;
}
