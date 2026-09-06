import { discoverStories } from '../lib/discover.js';
import { StorybrokrError, toErrorBody } from '../lib/errors.js';
import { inspectHost as defaultInspect, resolveHost } from '../lib/host.js';
import {
  configDirFor,
  generateConfigDir,
  instanceId,
  readSidecars,
  removeConfigDir,
  writeSidecar,
} from '../lib/instance.js';
import type { LogBuffer } from '../lib/logbuffer.js';
import { findFreePort } from '../lib/ports.js';
import { fetchStories, waitForReady } from '../lib/readiness.js';
import type { SpawnedProcess, Spawner } from '../lib/spawn.js';
import type { DaemonConfig, HostInfo, InstanceRecord, UpRequest } from '../types.js';
import type { Registry } from './registry.js';

export interface BrokerOptions {
  registry: Registry;
  spawner: Spawner;
  config: DaemonConfig;
  now?: () => Date;
  inspect?: typeof defaultInspect;
}

function isAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class Broker {
  private readonly registry: Registry;
  private readonly spawner: Spawner;
  private readonly config: DaemonConfig;
  private now: () => Date;
  private readonly inspect: typeof defaultInspect;
  private readonly procs = new Map<string, SpawnedProcess>();

  constructor(opts: BrokerOptions) {
    this.registry = opts.registry;
    this.spawner = opts.spawner;
    this.config = opts.config;
    this.now = opts.now ?? (() => new Date());
    this.inspect = opts.inspect ?? defaultInspect;
  }

  list(): InstanceRecord[] {
    return this.registry.list();
  }

  get(idOrPath: string, hostRoot?: string): InstanceRecord {
    const r = this.registry.resolve(idOrPath, hostRoot);
    this.registry.touch(r.id);
    return this.registry.get(r.id) as InstanceRecord;
  }

  touch(id: string): InstanceRecord {
    this.registry.touch(this.registry.resolve(id).id);
    return this.registry.get(id) as InstanceRecord;
  }

  logs(idOrPath: string, tail = 200): string[] {
    const r = this.registry.resolve(idOrPath);
    return this.procs.get(r.id)?.log.tail(tail) ?? [];
  }

  logStream(idOrPath: string): LogBuffer | undefined {
    return this.procs.get(this.registry.resolve(idOrPath).id)?.log;
  }

  inspectHost(path: string): HostInfo {
    return resolveHost(path);
  }

  async up(req: UpRequest): Promise<{ record: InstanceRecord; created: boolean }> {
    const host = req.hostRoot ? this.inspect(req.hostRoot) : resolveHost(req.component);
    const component = req.component.replace(/\/+$/, '');
    const existing = this.registry.find(host.hostRoot, component);
    if (existing && (existing.status === 'ready' || existing.status === 'starting')) {
      this.registry.touch(existing.id);
      if (req.wait !== false && existing.status === 'starting') await this.awaitReady(existing.id);
      return { record: this.registry.get(existing.id) as InstanceRecord, created: false };
    }
    if (existing) this.registry.remove(existing.id);

    const discovery = discoverStories(host.hostRoot, component, host.tsconfigPaths);
    const id = instanceId(host.hostRoot, component);
    const port = await findFreePort(
      this.config.portRangeStart,
      this.config.portRangeEnd,
      this.registry.portsInUse(),
    );
    const configDir = generateConfigDir(host, id, discovery.storyFiles);
    const nowIso = this.now().toISOString();
    const record: InstanceRecord = {
      id,
      hostRoot: host.hostRoot,
      component,
      framework: host.framework,
      port,
      url: `http://127.0.0.1:${port}`,
      pid: null,
      status: 'starting',
      createdAt: nowIso,
      lastTouchedAt: nowIso,
      ttlMinutes: req.ttlMinutes ?? this.config.ttlMinutes,
      storyFiles: discovery.storyFiles,
      stories: [],
      configDir,
    };
    this.registry.add(record);
    writeSidecar(configDir, record);

    const proc = this.spawner.spawn(host, configDir, port);
    this.procs.set(id, proc);
    this.registry.update(id, { pid: proc.pid });
    proc.exited.then((code) => {
      const current = this.registry.get(id);
      if (current && current.status === 'ready') {
        this.registry.update(id, {
          status: 'failed',
          exitCode: code,
          error: { code: 'BOOT_FAILED', message: `storybook exited with code ${code}` },
        });
      }
    });

    const readiness = this.watchReadiness(id, proc);
    if (req.wait === false) {
      readiness.catch(() => {});
      return { record: this.registry.get(id) as InstanceRecord, created: true };
    }
    await readiness;
    return { record: this.registry.get(id) as InstanceRecord, created: true };
  }

  private readonly pending = new Map<string, Promise<void>>();

  private watchReadiness(id: string, proc: SpawnedProcess): Promise<void> {
    const record = this.registry.get(id) as InstanceRecord;
    const p = waitForReady({
      port: record.port,
      log: proc.log,
      exited: proc.exited,
      timeoutMs: this.config.readinessTimeoutMs,
    })
      .then((stories) => {
        const updated = this.registry.update(id, {
          status: 'ready',
          stories,
          lastTouchedAt: this.now().toISOString(),
        });
        writeSidecar(record.configDir, updated);
      })
      .catch((err: unknown) => {
        const body = toErrorBody(err);
        this.registry.update(id, { status: 'failed', error: body });
        void proc.kill();
        throw err;
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    return p;
  }

  private async awaitReady(id: string): Promise<void> {
    const p = this.pending.get(id);
    if (p) await p;
  }

  async down(idOrPath: string): Promise<void> {
    const r = this.registry.resolve(idOrPath);
    await this.stop(r);
  }

  async downAll(): Promise<void> {
    for (const r of this.registry.list()) await this.stop(r);
  }

  private async stop(r: InstanceRecord): Promise<void> {
    const proc = this.procs.get(r.id);
    if (proc) await proc.kill();
    else if (isAlive(r.pid)) {
      try {
        process.kill(r.pid as number, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    this.procs.delete(r.id);
    this.registry.update(r.id, { status: 'stopped' });
    try {
      removeConfigDir(r.configDir);
    } catch {
      // the host may have been deleted; nothing to clean
    }
    this.registry.remove(r.id);
  }

  /** Stop ready instances idle past their TTL; returns what was stopped. */
  async reapIdle(): Promise<InstanceRecord[]> {
    const idle = this.registry.idleInstances();
    for (const r of idle) await this.stop(r);
    return idle;
  }

  /** On daemon start: adopt instances that are alive and answering, drop the rest. */
  async reconcile(): Promise<void> {
    this.registry.load();
    const known = new Map(this.registry.list().map((r) => [r.id, r]));
    for (const r of this.registry.list()) {
      for (const side of readSidecars(r.hostRoot))
        if (!known.has(side.id)) known.set(side.id, side);
    }
    for (const r of known.values()) {
      const alive = isAlive(r.pid) && (await fetchStories(r.port)) !== null;
      if (alive) {
        if (!this.registry.get(r.id)) this.registry.add(r);
        this.registry.update(r.id, { status: 'ready' });
      } else {
        if (this.registry.get(r.id)) this.registry.remove(r.id);
        try {
          removeConfigDir(configDirFor(r.hostRoot, r.id));
        } catch {
          // nothing to clean
        }
      }
    }
  }
}

export { StorybrokrError };
