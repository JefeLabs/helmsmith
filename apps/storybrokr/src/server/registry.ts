import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { StorybrokrError } from '../lib/errors.js';
import { stateFile } from '../lib/paths.js';
import type { DaemonConfig, InstanceRecord } from '../types.js';

interface StateFile {
  version: 1;
  instances: InstanceRecord[];
}

export interface RegistryOptions {
  home: string;
  config: DaemonConfig;
  now?: () => Date;
}

const ACTIVE = new Set(['starting', 'ready']);

export class Registry {
  private readonly byId = new Map<string, InstanceRecord>();
  private readonly file: string;
  private readonly config: DaemonConfig;
  private readonly now: () => Date;

  constructor(opts: RegistryOptions) {
    this.file = stateFile(opts.home);
    this.config = opts.config;
    this.now = opts.now ?? (() => new Date());
  }

  list(): InstanceRecord[] {
    return [...this.byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): InstanceRecord | undefined {
    return this.byId.get(id);
  }

  find(hostRoot: string, component: string): InstanceRecord | undefined {
    return this.list().find((r) => r.hostRoot === hostRoot && r.component === component);
  }

  /** Accepts an instance id, or a component path (optionally scoped to a host). */
  resolve(idOrPath: string, hostRoot?: string): InstanceRecord {
    const byId = this.byId.get(idOrPath);
    if (byId) return byId;
    const byPath = this.list().find(
      (r) => r.component === idOrPath && (hostRoot === undefined || r.hostRoot === hostRoot),
    );
    if (byPath) return byPath;
    throw new StorybrokrError('INSTANCE_NOT_FOUND', `no instance matches ${idOrPath}`);
  }

  add(record: InstanceRecord): void {
    const active = this.list().filter((r) => ACTIVE.has(r.status)).length;
    if (ACTIVE.has(record.status) && active >= this.config.instanceCap) {
      throw new StorybrokrError(
        'INSTANCE_CAP_REACHED',
        `instance cap of ${this.config.instanceCap} reached; run \`storybrokr down\` on one first`,
      );
    }
    this.byId.set(record.id, record);
    this.save();
  }

  update(id: string, patch: Partial<InstanceRecord>): InstanceRecord {
    const current = this.byId.get(id);
    if (!current) throw new StorybrokrError('INSTANCE_NOT_FOUND', `no instance ${id}`);
    const next = { ...current, ...patch };
    this.byId.set(id, next);
    this.save();
    return next;
  }

  remove(id: string): void {
    this.byId.delete(id);
    this.save();
  }

  touch(id: string): void {
    this.update(id, { lastTouchedAt: this.now().toISOString() });
  }

  portsInUse(): Set<number> {
    return new Set(
      this.list()
        .filter((r) => ACTIVE.has(r.status))
        .map((r) => r.port),
    );
  }

  /** Ready instances whose TTL is set and whose idle time exceeds it. */
  idleInstances(): InstanceRecord[] {
    const nowMs = this.now().getTime();
    return this.list().filter(
      (r) =>
        r.status === 'ready' &&
        r.ttlMinutes > 0 &&
        nowMs - Date.parse(r.lastTouchedAt) > r.ttlMinutes * 60_000,
    );
  }

  load(): void {
    this.byId.clear();
    if (!existsSync(this.file)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      return; // a corrupt cache is discarded; reconcile rebuilds from the sidecars
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const instances = (parsed as { instances?: unknown }).instances;
    if (!Array.isArray(instances)) return;
    for (const r of instances) {
      if (r !== null && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') {
        this.byId.set((r as InstanceRecord).id, r as InstanceRecord);
      }
    }
  }

  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const body: StateFile = { version: 1, instances: this.list() };
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}
