import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostInfo } from '../types.js';
import { commandSpawner, terminate } from './spawn.js';

const host = (root: string): HostInfo => ({
  hostRoot: root,
  storybookDir: join(root, '.storybook'),
  mainFile: join(root, '.storybook', 'main.ts'),
  previewFile: null,
  managerFile: null,
  framework: 'unknown',
  storybookBin: '/nonexistent',
  storybookVersion: '0',
  tsconfigPaths: {},
});

describe('commandSpawner', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('captures stdout+stderr into the log buffer and the log file, and resolves the exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-spawn-'));
    dirs.push(dir);
    const spawner = commandSpawner(process.execPath, [
      '-e',
      'console.log("hello"); console.error("warn"); process.exit(3)',
    ]);
    const proc = spawner.spawn(host(dir), dir, 6100);
    expect(proc.pid).toBeGreaterThan(0);
    expect(await proc.exited).toBe(3);
    expect(proc.log.lines).toEqual(expect.arrayContaining(['hello', 'warn']));
    expect(readFileSync(join(dir, 'storybook.log'), 'utf8')).toContain('hello');
  });

  it('kill() terminates a long-running child', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-spawn-'));
    dirs.push(dir);
    const spawner = commandSpawner(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const proc = spawner.spawn(host(dir), dir, 6100);
    await proc.kill();
    expect(await proc.exited).toBeNull(); // killed by signal → no exit code
  });

  it('survives a spawn failure: exited resolves null, the failure is logged, and kill() is a safe no-op', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-spawn-'));
    dirs.push(dir);
    const spawner = commandSpawner('/nonexistent/storybrokr-binary', []);
    const proc = spawner.spawn(host(dir), dir, 6100);
    expect(await proc.exited).toBeNull();
    expect(proc.log.lines.some((l) => l.startsWith('spawn failed:'))).toBe(true);
    await expect(proc.kill()).resolves.toBeUndefined();
  });
});

function isAlivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('terminate', () => {
  const pids: number[] = [];
  afterEach(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    pids.length = 0;
  });

  it('escalates to SIGKILL when the process ignores SIGTERM, and takes at least termWaitMs', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    const pid = child.pid as number;
    pids.push(pid);
    // Give the ignoring listener a moment to attach before we send SIGTERM.
    await new Promise((r) => setTimeout(r, 100));

    const start = Date.now();
    await terminate(pid, { termWaitMs: 300, killWaitMs: 2000, pollMs: 50 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(isAlivePid(pid)).toBe(false);
  });

  it('resolves quickly when the process exits normally on SIGTERM', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    const pid = child.pid as number;
    pids.push(pid);
    await new Promise((r) => setTimeout(r, 100));

    const start = Date.now();
    await terminate(pid);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(300);
    expect(isAlivePid(pid)).toBe(false);
  });
});
