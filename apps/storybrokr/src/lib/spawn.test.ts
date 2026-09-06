import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostInfo } from '../types.js';
import { commandSpawner } from './spawn.js';

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
