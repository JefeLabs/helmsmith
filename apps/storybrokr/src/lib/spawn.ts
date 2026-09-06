import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { HostInfo } from '../types.js';
import { LogBuffer } from './logbuffer.js';

export interface SpawnedProcess {
  pid: number;
  log: LogBuffer;
  exited: Promise<number | null>;
  kill(): Promise<void>;
}

export interface Spawner {
  spawn(host: HostInfo, configDir: string, port: number): SpawnedProcess;
}

export const STORYBOOK_ARGS = (configDir: string, port: number): string[] => [
  'dev',
  '--config-dir',
  configDir,
  '--port',
  String(port),
  '--exact-port',
  '--ci',
  '--no-open',
  '--disable-telemetry',
];

function wrap(child: ChildProcess, configDir: string): SpawnedProcess {
  const log = new LogBuffer();
  const file = createWriteStream(join(configDir, 'storybook.log'), { flags: 'a' });
  file.once('error', (err) => {
    log.push(`log file error: ${err.message}\n`);
  });
  const onData = (b: Buffer) => {
    const s = b.toString();
    log.push(s);
    file.write(s);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  let resolveExited!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => {
    resolveExited = resolve;
  });
  child.once('close', (code) => {
    file.end();
    resolveExited(code);
  });
  child.once('error', (err) => {
    log.push(`spawn failed: ${err.message}\n`);
    file.end();
    resolveExited(null);
  });
  return {
    pid: child.pid ?? -1,
    log,
    exited,
    kill: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const dead = await Promise.race([
        exited.then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), 5000)),
      ]);
      if (!dead) child.kill('SIGKILL');
      await exited;
    },
  };
}

/** Runs an arbitrary command in place of the host's storybook binary (tests). */
export function commandSpawner(command: string, args: string[]): Spawner {
  return {
    spawn(host, configDir) {
      const child = spawn(command, args, {
        cwd: host.hostRoot,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return wrap(child, configDir);
    },
  };
}

/** The real thing: the host's own node_modules/.bin/storybook. */
export const storybookSpawner: Spawner = {
  spawn(host, configDir, port) {
    const child = spawn(host.storybookBin, STORYBOOK_ARGS(configDir, port), {
      cwd: host.hostRoot,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return wrap(child, configDir);
  },
};
