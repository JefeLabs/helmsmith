import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { discoverStories, resolveComponentPath } from '../lib/discover.js';
import { StorybrokrError, toErrorBody } from '../lib/errors.js';
import { inspectHost as defaultInspect, realpathOrResolve, resolveHost } from '../lib/host.js';
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
import { type SpawnedProcess, type Spawner, terminate } from '../lib/spawn.js';
import type { DaemonConfig, HostInfo, InstanceRecord, ResolveScope, UpRequest } from '../types.js';
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

/** Resolve `component` (relative, `./`-prefixed, or absolute) to a path relative to hostRoot. */
function normalizeComponent(hostRoot: string, component: string): string {
  const abs = isAbsolute(component) ? realpathOrResolve(component) : resolve(hostRoot, component);
  const rel = relative(hostRoot, abs).split('\\').join('/');
  if (rel === '' || rel === '.') {
    throw new StorybrokrError(
      'COMPONENT_NOT_FOUND',
      'component must name a path inside the host root',
    );
  }
  if (rel.startsWith('..')) {
    throw new StorybrokrError('COMPONENT_NOT_FOUND', `${component} is outside ${hostRoot}`);
  }
  // a bare stem becomes its file here, so the record and the id match the full-path form
  return resolveComponentPath(hostRoot, rel);
}

export class Broker {
  private readonly registry: Registry;
  private readonly spawner: Spawner;
  private readonly config: DaemonConfig;
  private now: () => Date;
  private readonly inspect: typeof defaultInspect;
  private readonly procs = new Map<string, SpawnedProcess>();
  private readonly pending = new Map<string, Promise<void>>();
  /** In-flight `up` creations, keyed by instance id — closes the race between two concurrent
   * `up` calls for the same new component before either has written a registry record. */
  private readonly inflight = new Map<string, Promise<InstanceRecord>>();

  constructor(opts: BrokerOptions) {
    this.registry = opts.registry;
    this.spawner = opts.spawner;
    this.config = opts.config;
    this.now = opts.now ?? (() => new Date());
    this.inspect = opts.inspect ?? defaultInspect;
  }

  list(opts?: { host?: string }): InstanceRecord[] {
    const all = this.registry.list();
    if (!opts?.host) return all;
    const target = realpathOrResolve(opts.host);
    return all.filter((r) => realpathOrResolve(r.hostRoot) === target);
  }

  get(idOrPath: string, scope?: ResolveScope | string): InstanceRecord {
    const r = this.registry.resolve(idOrPath, scope);
    this.registry.touch(r.id);
    return this.registry.get(r.id) as InstanceRecord;
  }

  touch(idOrPath: string, scope?: ResolveScope | string): InstanceRecord {
    const r = this.registry.resolve(idOrPath, scope);
    this.registry.touch(r.id);
    return this.registry.get(r.id) as InstanceRecord;
  }

  logs(idOrPath: string, tail = 200, scope?: ResolveScope | string): string[] {
    const r = this.registry.resolve(idOrPath, scope);
    this.registry.touch(r.id);
    const proc = this.procs.get(r.id);
    if (proc) return proc.log.tail(tail);
    // adopted after a daemon restart: no buffer, but the child writes to its log file
    return tailFile(join(r.configDir, 'storybook.log'), tail);
  }

  logStream(idOrPath: string, scope?: ResolveScope | string): LogBuffer | undefined {
    const r = this.registry.resolve(idOrPath, scope);
    this.registry.touch(r.id);
    return this.procs.get(r.id)?.log;
  }

  inspectHost(path: string): HostInfo {
    return resolveHost(path);
  }

  async up(req: UpRequest): Promise<{ record: InstanceRecord; created: boolean }> {
    const host = req.hostRoot
      ? this.inspect(realpathOrResolve(req.hostRoot))
      : resolveHost(req.component);
    const component = normalizeComponent(host.hostRoot, req.component);
    const id = instanceId(host.hostRoot, component);
    let effectiveIncludeChildren = req.includeChildren;

    // An explicit TTL on a repeat up applies to the reused instance: the caller's
    // lease decides how long it lives (spec: TTL equals the lease).
    const applyTtl = (rid: string): void => {
      if (req.ttlMinutes !== undefined) this.registry.update(rid, { ttlMinutes: req.ttlMinutes });
    };
    // Per-instance lock: an up never interleaves with a stop (reaper or down) on the same id.
    const created = await this.withLock(id, async (): Promise<boolean | null> => {
      const existing = this.registry.find(host.hostRoot, component);
      if (existing?.status === 'starting') {
        applyTtl(existing.id);
        this.registry.touch(existing.id);
        return false;
      }
      if (existing?.status === 'ready') {
        // A repeat `up` re-discovers so a newly added sibling story file is picked up (spec §7.4).
        // When req.includeChildren is omitted, inherit the existing record's includeChildren setting
        // (records from before the flag existed were made with children: decision 13).
        effectiveIncludeChildren = req.includeChildren ?? existing.includeChildren ?? true;
        const discovery = discoverStories(host.hostRoot, component, host.tsconfigPaths, {
          includeChildren: effectiveIncludeChildren,
        });
        const sameFiles =
          discovery.storyFiles.length === existing.storyFiles.length &&
          discovery.storyFiles.every((f, i) => f === existing.storyFiles[i]);
        if (sameFiles) {
          // the same stories are served whatever the flag says: record the flag, keep the instance
          if ((existing.includeChildren ?? true) !== discovery.includedChildren) {
            this.registry.update(existing.id, { includeChildren: discovery.includedChildren });
          }
          applyTtl(existing.id);
          this.registry.touch(existing.id);
          return false;
        }
        await this.stopUnlocked(existing);
      } else if (existing) {
        this.registry.remove(existing.id);
      }

      const running = this.inflight.get(id);
      if (running) {
        await running;
        applyTtl(id);
        return null;
      }

      const creation = this.createInstance(host, component, id, {
        ...req,
        includeChildren: effectiveIncludeChildren,
      }).finally(() => {
        this.inflight.delete(id);
      });
      this.inflight.set(id, creation);
      await creation;
      return true;
    });
    if (req.wait !== false) await this.awaitReady(id);
    return { record: this.registry.get(id) as InstanceRecord, created: created === true };
  }

  private readonly locks = new Map<string, Promise<unknown>>();

  /** Serialise work on one instance id; different ids run in parallel. */
  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  /** Cap check → discover → port → config dir → add → sidecar → spawn, tracked in `inflight`
   * so a concurrent `up` for the same id can await it instead of repeating the work. Resolves
   * as soon as the record is registered and the child is spawned — it does NOT wait for
   * readiness, so a `wait: false` caller (or one arriving while this is in flight) always gets
   * a real record back. Readiness continues in the background via `watchReadiness`/`pending`. */
  private async createInstance(
    host: HostInfo,
    component: string,
    id: string,
    req: UpRequest,
  ): Promise<InstanceRecord> {
    const activeCount = this.registry
      .list()
      .filter((r) => r.status === 'starting' || r.status === 'ready').length;
    if (activeCount >= this.config.instanceCap) await this.reapIdle();
    this.registry.assertCapacity();

    const discovery = discoverStories(host.hostRoot, component, host.tsconfigPaths, {
      includeChildren: req.includeChildren,
    });
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
      includeChildren: discovery.includedChildren,
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

    this.watchReadiness(id, proc);
    return this.registry.get(id) as InstanceRecord;
  }

  private watchReadiness(id: string, proc: SpawnedProcess): Promise<void> {
    const record = this.registry.get(id) as InstanceRecord;
    const p = waitForReady({
      port: record.port,
      log: proc.log,
      exited: proc.exited,
      timeoutMs: this.config.readinessTimeoutMs,
    })
      .then((stories) => {
        if (this.registry.get(id)) {
          const updated = this.registry.update(id, {
            status: 'ready',
            stories,
            lastTouchedAt: this.now().toISOString(),
          });
          writeSidecar(record.configDir, updated);
        }
      })
      .catch((err: unknown) => {
        const body = toErrorBody(err);
        if (this.registry.get(id)) {
          this.registry.update(id, { status: 'failed', error: body });
        }
        void proc.kill();
        throw err;
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    p.catch(() => {});
    return p;
  }

  private async awaitReady(id: string): Promise<void> {
    const p = this.pending.get(id);
    if (p) await p;
  }

  async down(idOrPath: string, scope?: ResolveScope | string): Promise<void> {
    const r = this.registry.resolve(idOrPath, scope);
    await this.stop(r);
  }

  async downByHost(host: string): Promise<InstanceRecord[]> {
    const target = realpathOrResolve(host);
    const matching = this.registry.list().filter((r) => realpathOrResolve(r.hostRoot) === target);
    for (const r of matching) await this.stop(r);
    return matching;
  }

  async downAll(): Promise<void> {
    for (const r of this.registry.list()) await this.stop(r);
  }

  private stop(r: InstanceRecord): Promise<void> {
    return this.withLock(r.id, () => this.stopUnlocked(r));
  }

  private async stopUnlocked(r: InstanceRecord): Promise<void> {
    const proc = this.procs.get(r.id);
    if (proc) {
      await proc.kill();
    } else if (isAlive(r.pid)) {
      // No SpawnedProcess handle (an adopted instance, from a previous daemon process) — apply
      // spec §7.1's full ladder (SIGTERM, wait, SIGKILL) to the bare pid instead of one bare
      // SIGTERM, so a slow Storybook isn't left as an unfindable orphan.
      await terminate(r.pid as number);
    }
    this.procs.delete(r.id);
    if (this.registry.get(r.id)) this.registry.update(r.id, { status: 'stopped' });
    try {
      removeConfigDir(r.configDir);
    } catch {
      // the host may have been deleted; nothing to clean
    }
    if (this.registry.get(r.id)) this.registry.remove(r.id);
  }

  /** Stop ready instances idle past their TTL, active instances whose hostRoot disappeared, and
   * drop adopted instances whose process is gone (they have no exit watcher of their own). */
  async reapIdle(): Promise<InstanceRecord[]> {
    const idle = this.registry.idleInstances();
    const orphaned = this.registry
      .list()
      .filter(
        (r) =>
          (r.status === 'starting' || r.status === 'ready') &&
          !existsSync(r.hostRoot) &&
          !idle.some((i) => i.id === r.id),
      );
    const dead = this.registry
      .list()
      .filter(
        (r) =>
          (r.status === 'starting' || r.status === 'ready') &&
          !this.procs.has(r.id) &&
          !this.pending.has(r.id) &&
          !isAlive(r.pid),
      );
    const stopped: InstanceRecord[] = [];
    for (const r of [...idle, ...orphaned]) {
      // re-check inside the lock: an up may have touched or recreated it meanwhile
      await this.withLock(r.id, async () => {
        const current = this.registry.get(r.id);
        if (!current || current.createdAt !== r.createdAt) return;
        const stillIdle =
          current.status === 'ready' &&
          current.ttlMinutes > 0 &&
          this.now().getTime() - Date.parse(current.lastTouchedAt) > current.ttlMinutes * 60_000;
        if (!stillIdle && existsSync(current.hostRoot)) return;
        await this.stopUnlocked(current);
        stopped.push(current);
      });
    }
    for (const r of dead) {
      await this.withLock(r.id, async () => {
        if (!this.registry.get(r.id) || isAlive(r.pid)) return;
        this.registry.remove(r.id);
        try {
          removeConfigDir(r.configDir);
        } catch {
          // nothing to clean
        }
        stopped.push(r);
      });
    }
    return stopped;
  }

  /** An adopted instance still booting: poll its index until it is ready or the readiness timeout passes. */
  private watchAdopted(id: string): void {
    const record = this.registry.get(id);
    if (!record) return;
    const deadline = Date.now() + this.config.readinessTimeoutMs;
    const p = (async () => {
      for (;;) {
        const current = this.registry.get(id);
        if (!current) return;
        if (!isAlive(current.pid)) {
          this.registry.remove(id);
          return;
        }
        const stories = await fetchStories(current.port);
        if (stories) {
          const updated = this.registry.update(id, {
            status: 'ready',
            stories,
            lastTouchedAt: this.now().toISOString(),
          });
          writeSidecar(current.configDir, updated);
          return;
        }
        if (Date.now() > deadline) {
          this.registry.update(id, {
            status: 'failed',
            error: { code: 'BOOT_TIMEOUT', message: 'adopted instance never became ready' },
          });
          await terminate(current.pid as number);
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    p.catch(() => {});
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
      try {
        const stories = isAlive(r.pid) ? await fetchStories(r.port) : null;
        if (stories) {
          // adopt(), not add(): these instances were already live before this daemon process
          // (and its configured instanceCap) existed — asserting capacity here could reject a
          // legitimate reconcile and leave the daemon permanently unstartable (spec §7.5).
          if (!this.registry.get(r.id)) this.registry.adopt(r);
          this.registry.update(r.id, { status: 'ready', stories });
        } else if (isAlive(r.pid) && r.status === 'starting') {
          // still booting when the previous daemon died: adopt as starting and watch it
          if (!this.registry.get(r.id)) this.registry.adopt(r);
          this.watchAdopted(r.id);
        } else {
          if (this.registry.get(r.id)) this.registry.remove(r.id);
          try {
            removeConfigDir(configDirFor(r.hostRoot, r.id));
          } catch {
            // nothing to clean
          }
        }
      } catch (err) {
        // One bad record (a tampered sidecar, a filesystem error) must not abort reconcile for
        // every other instance — drop it and keep going.
        console.error(`storybrokr: reconcile dropped instance ${r.id}`, err);
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

/** Last `n` lines of a file, or none when it does not exist. */
function tailFile(path: string, n: number): string[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.slice(Math.max(0, lines.length - n));
}

export { StorybrokrError };
