/**
 * The CLI harnesses must hand the terminal back when a view quits, or the
 * host CLI never exits: `q` clears the screen and the process sits there
 * until killed. These tests run the real openTUI renderer under Bun in a
 * child process and require it to exit on its own.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const BUN = join(dirname(require.resolve('bun/package.json')), 'bin', 'bun.exe');
const FIXTURE = join(import.meta.dirname, '__fixtures__', 'quit-harness.ts');
/** Generous: a healthy teardown exits in well under a second. */
const EXIT_DEADLINE_MS = 8_000;

const children: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill('SIGKILL');
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Run {
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  /** Resolves with the exit code, or `'timeout'` if the process is still alive at the deadline. */
  exited: Promise<number | 'timeout'>;
}

function runHarness(mode: 'tui-view' | 'connect-view'): Run {
  const themeDir = mkdtempSync(join(tmpdir(), 'tui-teardown-'));
  dirs.push(themeDir);
  const child = spawn(BUN, ['--no-env-file', FIXTURE, mode, themeDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  let err = '';
  child.stdout?.on('data', (d) => {
    out += d;
  });
  child.stderr?.on('data', (d) => {
    err += d;
  });
  const exited = new Promise<number | 'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), EXIT_DEADLINE_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  return { child, stdout: () => out, stderr: () => err, exited };
}

describe('TUI harness teardown', () => {
  it('runTuiView: the process exits once the view quits', async () => {
    const run = runHarness('tui-view');

    const result = await run.exited;

    expect(run.stderr()).toContain('QUIT-RESOLVED');
    expect(result).toBe(0);
  }, 15_000);

  it('runConnectView: pressing q exits the process', async () => {
    const run = runHarness('connect-view');
    // The first output arrives before React has registered the keybinding, so a single
    // early `q` is lost. Re-send it until the view reports it quit (or the process ends).
    run.child.stdin?.on('error', () => {}); // EPIPE once the child has exited
    const presser = setInterval(() => {
      if (run.stderr().includes('QUIT-RESOLVED') || run.child.exitCode !== null) {
        clearInterval(presser);
        return;
      }
      run.child.stdin?.write('q');
    }, 200);

    const result = await run.exited;
    clearInterval(presser);

    expect(run.stderr()).toContain('QUIT-RESOLVED');
    expect(result).toBe(0);
  }, 15_000);
});
