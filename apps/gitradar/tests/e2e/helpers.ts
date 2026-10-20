import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The real launcher, so the Bun re-exec path is exercised, not just dist/cli.js. */
export const BIN = resolve(import.meta.dirname, '../../bin/gitradar');

export interface CliResult {
  stdout: string;
  stderr: string;
  /** Exit code; 1 when the process died by signal or timed out. */
  exitCode: number;
  timedOut: boolean;
}

export interface RunCliOptions {
  /** Extra or overriding env. A value of `undefined` removes the variable. */
  env?: Record<string, string | undefined>;
  /** Working directory. Default: the sandbox home. */
  cwd?: string;
  /** Default 20 s. On expiry the whole process group (sh + Bun) is SIGKILLed. */
  timeoutMs?: number;
}

export interface Sandbox {
  /** Temp dir used as HOME for the spawned CLI (outside any git repo). */
  home: string;
  /** `<home>/gitradar`, used as GITRADAR_HOME. */
  gitradarHome: string;
  /** A fresh empty directory under the sandbox, for use as a cwd. */
  mkdir(name: string): Promise<string>;
  cleanup(): Promise<void>;
}

/**
 * Create an isolated sandbox: a temp HOME plus a GITRADAR_HOME under it.
 * The CLI's registry lives at `$HOME/.agentx/repos.yml` (see #75), so both
 * must point into the sandbox for a run to leave the developer's store alone.
 */
export async function createSandbox(): Promise<Sandbox> {
  // realpath: macOS tmpdir is a symlink and the CLI prints resolved paths.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'gitradar-e2e-')));
  const gitradarHome = join(home, 'gitradar');
  await mkdir(gitradarHome, { recursive: true });
  return {
    home,
    gitradarHome,
    mkdir: async (name: string) => {
      const dir = join(home, name);
      await mkdir(dir, { recursive: true });
      return dir;
    },
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

/**
 * Run the CLI inside a sandbox. HOME and GITRADAR_HOME point at the sandbox
 * and GitHub tokens are blanked so nothing reaches the network. stdin is
 * closed immediately so an interactive prompt fails fast on EOF instead of
 * hanging. Never throws on a non-zero exit — callers check `exitCode`.
 */
export function runCli(sb: Sandbox, args: string[], opts: RunCliOptions = {}): Promise<CliResult> {
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: sb.home,
    GITRADAR_HOME: sb.gitradarHome,
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    NO_COLOR: '1',
    ...opts.env,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return new Promise((resolvePromise) => {
    const child = spawn(BIN, args, {
      cwd: opts.cwd ?? sb.home,
      env: env as Record<string, string>,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.stdin.end();
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }, opts.timeoutMs ?? 20_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr: `${stderr}${err.message}`, exitCode: 1, timedOut });
    });
  });
}
