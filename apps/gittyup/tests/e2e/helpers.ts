import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { dump } from 'js-yaml';
import { fixtureEnv } from '../../src/test/git-fixture.js';

const execFile = promisify(execFileCb);

/** The real launcher, so the Bun re-exec path is exercised, not just dist/cli.js. */
const BIN = resolve(import.meta.dirname, '../../bin/gittyup.mjs');

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
 * GitHub tokens are blanked so nothing reaches the network. Never throws
 * on a non-zero exit — callers check `exitCode`.
 */
export async function runCli(
  ws: Workspace,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CliResult> {
  const env = fixtureEnv({
    HOME: ws.dir,
    AGENTX_HOME: ws.dir,
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    COPILOT_GITHUB_TOKEN: '',
    ...opts.env,
  });
  try {
    const { stdout, stderr } = await execFile('node', [BIN, ...args], {
      cwd: ws.dir,
      env,
      timeout: opts.timeoutMs ?? 20_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}
