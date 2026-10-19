import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dump } from 'js-yaml';
import { fixtureEnv } from '../../src/test/git-fixture.js';

/** The real launcher, so the Bun re-exec path is exercised, not just dist/cli.js. */
const BIN = resolve(import.meta.dirname, '../../bin/gittyup.mjs');

export interface CliResult {
  stdout: string;
  stderr: string;
  /** Exit code; 1 when the process died by signal or timed out. */
  exitCode: number;
  /** True when `timeoutMs` elapsed and the process group was killed. */
  timedOut: boolean;
}

export interface RunCliOptions {
  env?: Record<string, string>;
  /** Default 20 s. On expiry the whole process group (node + Bun) is SIGKILLed. */
  timeoutMs?: number;
  /** Text written to stdin before it is closed. Default: nothing (immediate EOF). */
  stdin?: string;
  /** Keep stdin open so prompts block; only for testing the timeout path. */
  keepStdinOpen?: boolean;
}

export interface Workspace {
  /** Temp dir used as cwd and as HOME/AGENTX_HOME for the spawned CLI. */
  dir: string;
  /** Path of `<dir>/gittyup.yaml`. */
  manifestPath: string;
  /** Rewrite gittyup.yaml from an object. */
  writeManifest(manifest: Record<string, unknown>): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Create an isolated workspace: a temp dir (outside any git repo) holding a
 * `gittyup.yaml`. Defaults to an empty manifest.
 */
export async function createWorkspace(
  manifest: Record<string, unknown> = { workspace: '.', groups: {} },
): Promise<Workspace> {
  // realpath: macOS tmpdir is a symlink and the CLI prints resolved paths.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'gittyup-e2e-')));
  const manifestPath = join(dir, 'gittyup.yaml');
  const writeManifest = async (m: Record<string, unknown>) => {
    await writeFile(manifestPath, dump(m, { noRefs: true }), 'utf-8');
  };
  await writeManifest(manifest);
  return {
    dir,
    manifestPath,
    writeManifest,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Run the CLI inside a workspace. HOME and AGENTX_HOME point at the
 * workspace so config, cache and auth never touch the developer's home;
 * GitHub tokens are blanked so nothing reaches the network. stdin is
 * closed right after `opts.stdin` (if any) so an interactive prompt fails
 * fast on EOF instead of hanging. The child runs detached in its own
 * process group so a timeout kills the Bun re-exec too. Never throws on a
 * non-zero exit — callers check `exitCode` and `timedOut`.
 */
export function runCli(
  ws: Workspace,
  args: string[],
  opts: RunCliOptions = {},
): Promise<CliResult> {
  const env = fixtureEnv({
    HOME: ws.dir,
    AGENTX_HOME: ws.dir,
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    COPILOT_GITHUB_TOKEN: '',
    ...opts.env,
  });
  return new Promise((resolvePromise) => {
    const child = spawn('node', [BIN, ...args], {
      cwd: ws.dir,
      env,
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
    if (opts.stdin) child.stdin.write(opts.stdin);
    if (!opts.keepStdinOpen) child.stdin.end();

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
