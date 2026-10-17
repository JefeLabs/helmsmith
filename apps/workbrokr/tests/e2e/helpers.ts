import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BIN = join(APP_ROOT, 'bin', 'work.mjs');

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** A fresh HELMSMITH_HOME per test file so registries never collide. */
export function makeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'workbrokr-e2e-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export function runCli(
  args: string[],
  opts: { home: string; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: opts.cwd ?? APP_ROOT,
      env: { ...process.env, ...opts.env, HELMSMITH_HOME: opts.home, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => {
      stdout += b.toString();
    });
    child.stderr.on('data', (b) => {
      stderr += b.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`cli timed out: work ${args.join(' ')}\n${stderr}`));
    }, opts.timeoutMs ?? 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
