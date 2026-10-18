import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { WorkkitError } from './errors.js';
import type { Manifest, ServiceSpec } from './types.js';

const DEFAULT_HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 1_000;
const PROBE_CAP_MS = 10_000;
const STOP_COMMAND_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The process's start time as `ps` prints it: a pid plus this string identifies one process, not a reused number. */
export function pidSignature(pid: number): string {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

export function serviceModes(name: string, spec: ServiceSpec): ('backend' | 'fullstack')[] {
  if (spec.modes && spec.modes.length > 0) return spec.modes;
  return name === 'frontend' ? ['fullstack'] : ['backend', 'fullstack'];
}

export interface RunnerArgs {
  m: Manifest;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logDir: string;
  mode?: 'backend' | 'fullstack';
  onlyServices?: string[];
  onLog?: (line: string) => void;
  /** called the moment a service's process exists, before its health is known */
  onSpawn?: (service: string, pid: number, signature: string) => void;
}

/** One health probe, time-boxed: exit 0, and when `healthyCodes` is set the last stdout token is one of them. */
export function probe(
  spec: ServiceSpec,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number = PROBE_CAP_MS,
): { healthy: boolean; last: string } {
  const r = spawnSync('sh', ['-c', spec.health], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: Math.max(100, timeoutMs),
  });
  const out = (r.stdout ?? '').trim();
  const last = out.split(/\s+/).filter(Boolean).pop() ?? '';
  if (r.error) return { healthy: false, last: `probe ${r.error.message}` };
  if (r.status !== 0) return { healthy: false, last: (r.stderr ?? '').trim() || out };
  if (spec.healthyCodes && spec.healthyCodes.length > 0)
    return { healthy: spec.healthyCodes.includes(Number(last)), last };
  return { healthy: true, last };
}

export async function waitHealthy(o: {
  name: string;
  spec: ServiceSpec;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<void> {
  const budget = o.timeoutMs ?? o.spec.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const deadline = Date.now() + budget;
  let last = '';
  while (Date.now() < deadline) {
    const p = probe(o.spec, o.cwd, o.env, Math.min(PROBE_CAP_MS, deadline - Date.now()));
    if (p.healthy) return;
    last = p.last;
    if (Date.now() >= deadline) break;
    await sleep(Math.min(HEALTH_POLL_MS, Math.max(0, deadline - Date.now())));
  }
  throw new WorkkitError(
    'HEALTH_TIMEOUT',
    `service "${o.name}" was not healthy within ${(budget / 1000).toFixed(0)} s (last probe: ${last || 'no output'})`,
    { service: o.name, last },
  );
}

/** Start one service detached in its own process group, logging to <logDir>/<name>.log; returns the group leader's pid. */
function spawnService(name: string, spec: ServiceSpec, a: RunnerArgs): number {
  const fd = openSync(join(a.logDir, `${name}.log`), 'a');
  try {
    const child = spawn('sh', ['-c', spec.start], {
      cwd: a.cwd,
      env: a.env,
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    if (child.pid === undefined) {
      throw new WorkkitError('SERVICE_FAILED', `service "${name}" did not spawn: ${spec.start}`, {
        service: name,
      });
    }
    return child.pid;
  } finally {
    closeSync(fd);
  }
}

/** Start every service in manifest order, waiting for each one's health; on failure stop what started. */
export async function startServices(
  a: RunnerArgs,
): Promise<{ pids: Record<string, number>; signatures: Record<string, string> }> {
  const pids: Record<string, number> = {};
  const signatures: Record<string, string> = {};
  const targetMode = a.mode ?? 'fullstack';
  const entries = Object.entries(a.m.services).filter(([name, spec]) => {
    if (a.onlyServices) return a.onlyServices.includes(name);
    return serviceModes(name, spec).includes(targetMode);
  });
  for (const [name, spec] of entries) {
    a.onLog?.(`starting ${name}: ${spec.start}`);
    pids[name] = spawnService(name, spec, a);
    signatures[name] = pidSignature(pids[name]);
    a.onSpawn?.(name, pids[name], signatures[name]);
    try {
      await waitHealthy({ name, spec, cwd: a.cwd, env: a.env });
    } catch (err) {
      await stopServices({ m: a.m, cwd: a.cwd, env: a.env, pids, signatures, onLog: a.onLog });
      throw err;
    }
    a.onLog?.(`${name} healthy (pid ${pids[name]})`);
  }
  return { pids, signatures };
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/**
 * Run each `stop` in reverse order (time-boxed), then SIGTERM and finally SIGKILL only the pids we
 * started — and only while each pid still carries the start-time signature recorded at spawn.
 */
export async function stopServices(o: {
  m: Manifest;
  cwd: string;
  env: NodeJS.ProcessEnv;
  pids: Record<string, number>;
  signatures?: Record<string, string>;
  skipStopCommands?: boolean;
  onLog?: (line: string) => void;
}): Promise<void> {
  const names = Object.keys(o.m.services)
    .filter((n) => o.pids[n] !== undefined)
    .reverse();
  if (!o.skipStopCommands) {
    for (const name of names) {
      const spec = o.m.services[name];
      o.onLog?.(`stopping ${name}: ${spec.stop}`);
      const r = spawnSync('sh', ['-c', spec.stop], {
        cwd: o.cwd,
        env: o.env,
        encoding: 'utf8',
        timeout: STOP_COMMAND_TIMEOUT_MS,
      });
      if (r.error) o.onLog?.(`stop command for ${name} ${r.error.message}`);
    }
  }
  const ours = names.filter((n) => {
    const pid = o.pids[n];
    if (!isAlive(pid)) return false;
    const expected = o.signatures?.[n];
    if (expected === undefined) return true;
    const actual = pidSignature(pid);
    if (actual !== expected) {
      o.onLog?.(
        `not signalling pid ${pid} (${n}): it is no longer the process started for this lease`,
      );
      return false;
    }
    return true;
  });
  const alive = () => ours.filter((n) => isAlive(o.pids[n]));
  if (alive().length === 0) return;
  for (const n of alive()) killGroup(o.pids[n], 'SIGTERM');
  const deadline = Date.now() + STOP_GRACE_MS;
  while (alive().length > 0 && Date.now() < deadline) await sleep(200);
  for (const n of alive()) killGroup(o.pids[n], 'SIGKILL');
  const hardDeadline = Date.now() + STOP_GRACE_MS;
  while (alive().length > 0 && Date.now() < hardDeadline) await sleep(100);
}
