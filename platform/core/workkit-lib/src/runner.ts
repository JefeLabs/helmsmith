import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { WorkkitError } from './errors.js';
import type { Manifest, ServiceSpec } from './types.js';

const DEFAULT_HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_POLL_MS = 1_000;
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

export interface RunnerArgs {
  m: Manifest;
  cwd: string;
  env: NodeJS.ProcessEnv;
  logDir: string;
  onLog?: (line: string) => void;
}

/** One health probe: exit 0, and when `healthyCodes` is set the last stdout token is one of them. */
export function probe(
  spec: ServiceSpec,
  cwd: string,
  env: NodeJS.ProcessEnv,
): { healthy: boolean; last: string } {
  const r = spawnSync('sh', ['-c', spec.health], { cwd, env, encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  const last = out.split(/\s+/).filter(Boolean).pop() ?? '';
  if (r.status !== 0) return { healthy: false, last: (r.stderr ?? '').trim() || out };
  if (spec.healthyCodes && spec.healthyCodes.length > 0) {
    return { healthy: spec.healthyCodes.includes(Number(last)), last };
  }
  return { healthy: true, last };
}

export async function waitHealthy(o: {
  name: string;
  spec: ServiceSpec;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<void> {
  const deadline =
    Date.now() + (o.timeoutMs ?? o.spec.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
  let last = '';
  while (Date.now() < deadline) {
    const p = probe(o.spec, o.cwd, o.env);
    if (p.healthy) return;
    last = p.last;
    await sleep(HEALTH_POLL_MS);
  }
  throw new WorkkitError(
    'HEALTH_TIMEOUT',
    `service "${o.name}" was not healthy within ${((o.timeoutMs ?? o.spec.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS) / 1000).toFixed(0)} s (last probe: ${last || 'no output'})`,
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
export async function startServices(a: RunnerArgs): Promise<{ pids: Record<string, number> }> {
  const pids: Record<string, number> = {};
  for (const [name, spec] of Object.entries(a.m.services)) {
    a.onLog?.(`starting ${name}: ${spec.start}`);
    pids[name] = spawnService(name, spec, a);
    try {
      await waitHealthy({ name, spec, cwd: a.cwd, env: a.env });
    } catch (err) {
      await stopServices({ m: a.m, cwd: a.cwd, env: a.env, pids });
      throw err;
    }
    a.onLog?.(`${name} healthy (pid ${pids[name]})`);
  }
  return { pids };
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

/** Run each `stop` in reverse order, then SIGTERM and finally SIGKILL only the pids we started. */
export async function stopServices(o: {
  m: Manifest;
  cwd: string;
  env: NodeJS.ProcessEnv;
  pids: Record<string, number>;
  onLog?: (line: string) => void;
}): Promise<void> {
  const names = Object.keys(o.m.services)
    .filter((n) => o.pids[n] !== undefined)
    .reverse();
  for (const name of names) {
    const spec = o.m.services[name];
    o.onLog?.(`stopping ${name}: ${spec.stop}`);
    spawnSync('sh', ['-c', spec.stop], { cwd: o.cwd, env: o.env, encoding: 'utf8' });
  }
  const alive = () => names.filter((n) => isAlive(o.pids[n]));
  if (alive().length === 0) return;
  for (const n of alive()) killGroup(o.pids[n], 'SIGTERM');
  const deadline = Date.now() + STOP_GRACE_MS;
  while (alive().length > 0 && Date.now() < deadline) await sleep(200);
  for (const n of alive()) killGroup(o.pids[n], 'SIGKILL');
  const hardDeadline = Date.now() + STOP_GRACE_MS;
  while (alive().length > 0 && Date.now() < hardDeadline) await sleep(100);
}
