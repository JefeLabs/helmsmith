import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const execFile = promisify(execFileCb);

const CLI_PATH = resolve(import.meta.dirname, '../../dist/cli.js');

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI with the given arguments.
 * Returns stdout, stderr, and exitCode (0 on success, 1 on failure).
 * Does NOT throw on non-zero exit — callers check exitCode.
 */
export async function runCli(
  args: string[],
  env?: Record<string, string>,
  timeoutMs = 10_000,
): Promise<CliResult> {
  try {
    const result = await execFile('node', [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      timeout: timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
    };
  }
}

/**
 * Create a temp directory for AGENTX_USERDATA isolation.
 */
export async function createTempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agentx-e2e-'));
}

/**
 * Remove a temp directory.
 */
export async function cleanupTempHome(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/**
 * Path to the sample-plan.md fixture (absolute).
 */
export const FIXTURE_PLAN_MD = resolve(import.meta.dirname, '../fixtures/sample-plan.md');
