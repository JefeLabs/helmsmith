import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { WorkkitError } from './errors.js';
import { lockDir, registryFile } from './paths.js';
import { portsForSlot } from './ports.js';
import type {
  Effort,
  Lease,
  LeaseKind,
  Manifest,
  Owner,
  ProjectEntry,
  RegistryFile,
} from './types.js';

export const newId = (prefix: string) => `${prefix}_${randomBytes(4).toString('hex')}`;

const EMPTY: RegistryFile = { version: 1, projects: {}, leases: [], efforts: [] };
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;

/** Synchronous sleep: the lock is held for microseconds, so a busy wait with a pause is fine. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class Registry {
  private constructor(
    private readonly home: string,
    private readonly now: () => Date,
  ) {}

  static open(home: string, now: () => Date = () => new Date()): Registry {
    mkdirSync(home, { recursive: true });
    return new Registry(home, now);
  }

  read(): RegistryFile {
    const file = registryFile(this.home);
    if (!existsSync(file)) return structuredClone(EMPTY);
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as RegistryFile;
    } catch {
      return structuredClone(EMPTY);
    }
  }

  /** Lock, re-read, mutate, write atomically, unlock. The only way state changes. */
  update<T>(fn: (r: RegistryFile) => T): T {
    const lock = lockDir(this.home);
    const started = Date.now();
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
            rmSync(lock, { recursive: true, force: true });
            continue;
          }
        } catch {
          continue; // the lock vanished between the failed mkdir and the stat: retry at once
        }
        if (Date.now() - started > LOCK_WAIT_MS) {
          throw new WorkkitError(
            'INTERNAL',
            `registry lock ${lock} held for over ${LOCK_WAIT_MS} ms`,
          );
        }
        sleep(25);
      }
    }
    try {
      const r = this.read();
      const out = fn(r);
      const file = registryFile(this.home);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(r, null, 2)}\n`);
      renameSync(tmp, file);
      return out;
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }

  project(name: string): ProjectEntry | undefined {
    return this.read().projects[name];
  }

  upsertProject(name: string, entry: ProjectEntry): void {
    this.update((r) => {
      r.projects[name] = entry;
    });
  }

  leases(filter: Partial<Pick<Lease, 'project' | 'kind' | 'effort'>> = {}): Lease[] {
    return this.read().leases.filter((l) =>
      Object.entries(filter).every(([k, v]) => (l as unknown as Record<string, unknown>)[k] === v),
    );
  }

  efforts(filter: Partial<Pick<Effort, 'project' | 'area' | 'state'>> = {}): Effort[] {
    return this.read().efforts.filter((e) =>
      Object.entries(filter).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v),
    );
  }

  activeEffortFor(project: string, area: string): Effort | undefined {
    return this.efforts({ project, area, state: 'active' })[0];
  }

  allocateSlot(project: string, m: Manifest, owner: Owner, effort: string): Lease {
    return this.update((r) => {
      const taken = new Set(
        r.leases
          .filter((l) => l.project === project && l.kind === 'slot')
          .map((l) => l.value as number),
      );
      const reserved = new Set(m.slots.reserved);
      let slot = -1;
      for (let n = 0; n < m.slots.count; n++) {
        if (!taken.has(n) && !reserved.has(n)) {
          slot = n;
          break;
        }
      }
      if (slot < 0) {
        throw new WorkkitError(
          'NO_FREE_SLOT',
          `no free slot in ${project} (0..${m.slots.count - 1}, reserved ${[...reserved].join(',')})`,
        );
      }
      const lease = this.lease(
        project,
        'slot',
        slot,
        owner,
        effort,
        m.expiry.slotHours,
        portsForSlot(m, slot),
      );
      r.leases.push(lease);
      return lease;
    });
  }

  addLease(
    kind: LeaseKind,
    project: string,
    value: string | number,
    owner: Owner,
    effort: string,
    hours: number,
    extra: Partial<Lease> = {},
  ): Lease {
    return this.update((r) => {
      const l = { ...this.lease(project, kind, value, owner, effort, hours), ...extra };
      r.leases.push(l);
      return l;
    });
  }

  private lease(
    project: string,
    kind: LeaseKind,
    value: string | number,
    owner: Owner,
    effort: string,
    hours: number,
    ports?: Record<string, number>,
  ): Lease {
    const now = this.now();
    return {
      id: newId('lease'),
      project,
      kind,
      value,
      ...(ports ? { ports } : {}),
      owner,
      effort,
      created: now.toISOString(),
      touched: now.toISOString(),
      expires: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    };
  }

  touch(leaseId: string, hours: number): void {
    this.update((r) => {
      const l = r.leases.find((x) => x.id === leaseId);
      if (!l) throw new WorkkitError('LEASE_NOT_FOUND', leaseId);
      const now = this.now();
      l.touched = now.toISOString();
      l.expires = new Date(now.getTime() + hours * 3_600_000).toISOString();
    });
  }

  patchLease(leaseId: string, patch: Partial<Lease>): void {
    this.update((r) => {
      const i = r.leases.findIndex((x) => x.id === leaseId);
      if (i < 0) throw new WorkkitError('LEASE_NOT_FOUND', leaseId);
      r.leases[i] = { ...r.leases[i], ...patch };
    });
  }

  release(leaseId: string): void {
    this.update((r) => {
      r.leases = r.leases.filter((l) => l.id !== leaseId);
    });
  }

  expired(now: Date = this.now()): Lease[] {
    return this.read().leases.filter((l) => Date.parse(l.expires) < now.getTime());
  }

  addEffort(e: Effort): void {
    this.update((r) => {
      r.efforts.push(e);
    });
  }

  updateEffort(id: string, patch: Partial<Effort>): Effort {
    return this.update((r) => {
      const i = r.efforts.findIndex((e) => e.id === id);
      if (i < 0) throw new WorkkitError('EFFORT_NOT_FOUND', `no effort ${id}`);
      r.efforts[i] = { ...r.efforts[i], ...patch };
      return r.efforts[i];
    });
  }

  removeEfforts(predicate: (e: Effort) => boolean): number {
    return this.update((r) => {
      const before = r.efforts.length;
      r.efforts = r.efforts.filter((e) => !predicate(e));
      return before - r.efforts.length;
    });
  }
}
