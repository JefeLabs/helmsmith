import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BIN = join(APP_ROOT, 'bin', 'storybrokr.mjs');
export const FIXTURE_HOST = join(APP_ROOT, 'tests', 'e2e', 'fixtures', 'host-react-vite');

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** A fresh STORYBROKR_HOME per test file so daemons never collide. */
export function makeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'storybrokr-e2e-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export function runCli(
  args: string[],
  opts: { home: string; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: opts.cwd ?? APP_ROOT,
      env: { ...process.env, ...opts.env, STORYBROKR_HOME: opts.home, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`cli timed out: storybrokr ${args.join(' ')}\n${stderr}`));
    }, opts.timeoutMs ?? 170_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export async function runJson<T>(args: string[], opts: { home: string; cwd?: string }): Promise<T> {
  const r = await runCli([...args, '--json'], opts);
  if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout) as T;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
