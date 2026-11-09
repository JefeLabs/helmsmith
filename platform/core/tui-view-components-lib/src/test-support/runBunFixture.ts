/**
 * Run a test fixture under the vendored Bun (openTUI's renderer needs Bun;
 * vitest runs on Node) and hand back its exit status and output.
 *
 * SIGKILL on timeout, not the default SIGTERM: openTUI installs a SIGTERM
 * handler, and a fixture stuck in a render loop never gets to run it, so
 * SIGTERM leaves spawnSync waiting forever.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
export const BUN = join(dirname(require.resolve('bun/package.json')), 'bin', 'bun.exe');

export interface FixtureRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `bun <fixture> ...args <themeDir>` with a throwaway theme dir. */
export function runBunFixture(fixture: string, args: string[], timeoutMs = 15_000): FixtureRun {
  const themeDir = mkdtempSync(join(tmpdir(), 'tui-fixture-'));
  try {
    const run = spawnSync(BUN, ['--no-env-file', fixture, ...args, themeDir], {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  } finally {
    rmSync(themeDir, { recursive: true, force: true });
  }
}

/** The `KEY=value` lines a fixture printed, as a record. */
export function fixtureValues(run: FixtureRun): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of run.stdout.matchAll(/^([A-Z_]+)=(.*)$/gm)) out[m[1] as string] = m[2] as string;
  return out;
}
