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
  Notice,
  Owner,
  ProjectEntry,
  RegistryFile,
} from './types.js';

export const newId = (prefix: string) => `${prefix}_${randomBytes(4).toString('hex')}`;

const EMPTY: RegistryFile = { version: 1, projects: {}, leases: [], efforts: [] };
// The lock is held for microseconds, so anything older than the stale threshold belongs to a
// dead process; the wait must exceed it, or every command fails for the gap between the two.
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 15_000;

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

  /** The registry as it is on disk. A file that does not parse is refused, never replaced. */
  read(): RegistryFile {
    const file = registryFile(this.home);
    if (!existsSync(file)) return structuredClone(EMPTY);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new WorkkitError(
        'INTERNAL',
        `${file} is corrupt (${err instanceof Error ? err.message : String(err)}); nothing was changed. Move it aside (mv ${file} ${file}.corrupt-$(date +%s)) to start fresh, knowing its leases and running pids are lost`,
        { file },
      );
    }
    const r = parsed as Partial<RegistryFile> | null;
    if (!r || typeof r !== 'object' || r.version !== 1) {
      throw new WorkkitError(
        'INTERNAL',
        `${file} has an unknown registry version (${String(r?.version)}); this build reads version 1`,
        { file },
      );
    }
    return {
      version: 1,
      projects: r.projects ?? {},
      leases: r.leases ?? [],
      efforts: r.efforts ?? [],
      notices: r.notices ?? [],
    };
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
            // claim the stale lock by renaming it: two waiters cannot both win the rename,
            // so neither deletes a fresh lock the other just took
            const claimed = `${lock}.stale.${process.pid}.${Date.now()}`;
            renameSync(lock, claimed);
            rmSync(claimed, { recursive: true, force: true });
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

  efforts(filter: Partial<Pick<Effort, 'project' | 'area' | 'task' | 'state'>> = {}): Effort[] {
    return this.read().efforts.filter((e) =>
      Object.entries(filter).every(([k, v]) => (e as unknown as Record<string, unknown>)[k] === v),
    );
  }

  activeEffortFor(project: string, area: string, task?: string): Effort | undefined {
    return this.efforts({ project, area, state: 'active' }).find(
      (e) => (e.task ?? undefined) === (task ?? undefined),
    );
  }

  /** An effort that is being started counts as open: nobody else may start on the same (area, task) meanwhile. */
  openEffortFor(project: string, area: string, task?: string): Effort | undefined {
    return this.efforts({ project, area }).find(
      (e) =>
        (e.state === 'starting' || e.state === 'active') &&
        (e.task ?? undefined) === (task ?? undefined),
    );
  }

  addNotice(project: string, area: string, notice: Notice): void {
    this.update((r) => {
      const existing = r.notices ?? [];
      const dup = existing.findIndex(
        (n) =>
          n.project === project &&
          n.area === area &&
          n.notice.from === notice.from &&
          n.notice.text === notice.text,
      );
      if (dup >= 0) {
        existing[dup] = { project, area, notice };
        r.notices = existing;
      } else {
        r.notices = [...existing, { project, area, notice }];
      }
    });
  }

  notices(project: string, area: string): Notice[] {
    return (this.read().notices ?? [])
      .filter((n) => n.project === project && n.area === area)
      .map((n) => n.notice);
  }

  clearNotices(project: string, area: string): void {
    this.update((r) => {
      r.notices = (r.notices ?? []).filter((n) => !(n.project === project && n.area === area));
    });
  }

  clearNoticesFrom(project: string, branches: string[]): void {
    const set = new Set(branches);
    this.update((r) => {
      r.notices = (r.notices ?? []).filter(
        (n) => !(n.project === project && set.has(n.notice.from)),
      );
    });
  }

  pruneNoticesWhere(project: string, area: string, remove: (n: Notice) => boolean): void {
    this.update((r) => {
      r.notices = (r.notices ?? []).filter(
        (n) => !(n.project === project && n.area === area && remove(n.notice)),
      );
    });
  }

  allocateSlot(
    project: string,
    m: Manifest,
    owner: Owner,
    effort: string,
    exclude: Set<number> = new Set(),
  ): Lease {
    return this.update((r) => {
      const taken = new Set(
        r.leases
          .filter((l) => l.project === project && l.kind === 'slot')
          .map((l) => l.value as number),
      );
      const reserved = new Set(m.slots.reserved);
      let slot = -1;
      for (let n = 0; n < m.slots.count; n++) {
        if (!taken.has(n) && !reserved.has(n) && !exclude.has(n)) {
          slot = n;
          break;
        }
      }
      if (slot < 0) {
        throw new WorkkitError(
          'NO_FREE_SLOT',
          `no free slot in ${project} (0..${m.slots.count - 1}, reserved ${[...reserved].join(',')}): \`work status\` lists the efforts holding them; \`work finish\` or \`work reap\` frees one`,
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
