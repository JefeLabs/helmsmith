/**
 * Probe whether a CLI tool is installed and parse its version.
 * Layers above this (ensure, registry, CLI commands) treat its output
 * as ground truth for "is this binary on the user's PATH and runnable?"
 *
 * Implementation: spawn `which`/`where` for path resolution, spawn the
 * tool itself with a version flag for version parsing. No PATH munging
 * — we trust the user's shell configuration.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectPlatform } from '../platform/detect.js';

const execFileAsync = promisify(execFile);

export interface ToolCheckResult {
  /** Is the binary on PATH? */
  installed: boolean;
  /** Resolved absolute path to the binary, or null if not found. */
  path: string | null;
  /** Parsed version string (e.g. "2.43.0"), or null if not parseable. */
  version: string | null;
}

export async function checkTool(
  toolName: string,
  options: { versionFlag?: string; versionRegex?: RegExp } = {},
): Promise<ToolCheckResult> {
  const path = await resolveBinaryPath(toolName);
  if (!path) {
    return { installed: false, path: null, version: null };
  }
  const version = await parseToolVersion(toolName, options);
  return { installed: true, path, version };
}

export async function isInstalled(toolName: string): Promise<boolean> {
  const path = await resolveBinaryPath(toolName);
  return path !== null;
}

export async function getPath(toolName: string): Promise<string | null> {
  return resolveBinaryPath(toolName);
}

export async function getVersion(
  toolName: string,
  options: { versionFlag?: string; versionRegex?: RegExp } = {},
): Promise<string | null> {
  return parseToolVersion(toolName, options);
}

// ─── internals ──────────────────────────────────────────────────────

/**
 * Use `which` (POSIX) or `where` (Windows) to resolve the tool's path.
 * Returns the FIRST result when there are multiple matches — that
 * matches the behavior of running the tool from a shell.
 */
async function resolveBinaryPath(toolName: string): Promise<string | null> {
  const platform = detectPlatform().platform;
  const cmd = platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(cmd, [toolName]);
    const first = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
    return first ? first.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Default version probe: run `<tool> --version`, parse the first
 * SemVer-shaped substring in stdout/stderr. Callers can override the
 * flag (some tools use `-V` or `version`) and the regex.
 */
async function parseToolVersion(
  toolName: string,
  options: { versionFlag?: string; versionRegex?: RegExp },
): Promise<string | null> {
  const flag = options.versionFlag ?? '--version';
  const regex = options.versionRegex ?? /(\d+\.\d+(?:\.\d+)?(?:-\S+)?)/;
  try {
    const { stdout, stderr } = await execFileAsync(toolName, [flag]);
    const haystack = `${stdout}\n${stderr}`;
    const match = haystack.match(regex);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
