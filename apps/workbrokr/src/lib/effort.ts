import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertNotProtected,
  commonsTouched,
  type Effort,
  emitWorktreeConfig,
  expandScopes,
  Git,
  globsOverlap,
  type Lease,
  type Manifest,
  type Mode,
  type Notice,
  newId,
  type Owner,
  portsForSlot,
  type Registry,
  runRefresh,
  selectRefresh,
  slotVars,
  WorkkitError,
} from '@helmsmith/workkit';
import type { StorybrokrClient } from './storybrokr.js';

export interface ServiceRunner {
  start(a: {
    m: Manifest;
    cwd: string;
    env: NodeJS.ProcessEnv;
    logDir: string;
    onLog?: (l: string) => void;
  }): Promise<{ pids: Record<string, number> }>;
  stop(o: {
    m: Manifest;
    cwd: string;
    env: NodeJS.ProcessEnv;
    pids: Record<string, number>;
    onLog?: (l: string) => void;
  }): Promise<void>;
}

export interface Ctx {
  home: string;
  repoRoot: string;
  manifest: Manifest;
  registry: Registry;
  owner: Owner;
  runner: ServiceRunner;
  storybrokr: StorybrokrClient;
  log: (line: string) => void;
}

export interface StartOptions {
  area: string;
  type: string;
  mode: Mode;
  join?: boolean;
  sync?: boolean;
  story?: string;
}

export interface StartResult {
  effort: Effort;
  leases: Lease[];
  sync: 'up-to-date' | 'ff' | 'merge' | 'skipped';
  refreshed: string[];
  marks: string[];
  joined: boolean;
  warnings: string[];
}

export const worktreePathFor = (ctx: Ctx, area: string) =>
  join(ctx.repoRoot, ctx.manifest.worktreeRoot, area);
const branchFor = (type: string, area: string) => `${type}/${area}`;
const now = () => new Date().toISOString();

function guardStart(
  ctx: Ctx,
  o: StartOptions,
): { branch: string; scopes: string[]; commons: string[]; warnings: string[] } {
  const m = ctx.manifest;
  const spec = m.areas[o.area];
  if (!spec)
    throw new WorkkitError(
      'AREA_UNKNOWN',
      `unknown area "${o.area}" (known: ${Object.keys(m.areas).join(', ')})`,
      { area: o.area },
    );
  if (!m.branch.types.includes(o.type))
    throw new WorkkitError(
      'TYPE_UNKNOWN',
      `unknown type "${o.type}" (allowed: ${m.branch.types.join(', ')})`,
      { type: o.type },
    );
  if (o.mode !== 'frontend' && o.mode !== 'fullstack')
    throw new WorkkitError('MODE_UNKNOWN', `unknown mode "${o.mode}" (frontend | fullstack)`);
  const branch = branchFor(o.type, o.area);
  assertNotProtected(m, branch);
  const scopes = expandScopes(m, o.area, o.mode);
  const commons = spec.commons ?? [];
  const warnings: string[] = [];
  for (const e of ctx.registry.efforts({ project: m.project, state: 'active' })) {
    if (e.area === o.area) continue;
    const pairs = globsOverlap(scopes, e.scopes);
    if (pairs.length > 0) {
      throw new WorkkitError(
        'SCOPE_CONFLICT',
        `scope overlaps the active effort on ${e.area} (${e.branch}, owner ${e.owner.session}): ${pairs.join('; ')}`,
        { with: e.area, owner: e.owner.session, effort: e.id, pairs },
      );
    }
    if (commons.length > 0 && existsSync(e.worktree)) {
      const g = new Git(e.worktree);
      const changed = g
        .tryRun(['diff', '--name-only', `origin/${m.baseBranch}`, 'HEAD'])
        .out.split('\n')
        .filter(Boolean);
      const hit = commonsTouched(m, changed).filter((c) => commons.includes(c));
      if (hit.length > 0)
        warnings.push(
          `${e.area} (${e.branch}, ${e.owner.session}) already has commits under commons ${hit.join(', ')}: coordinate or wait for its merge`,
        );
    }
  }
  return { branch, scopes, commons, warnings };
}

function ensureWorktree(ctx: Ctx, area: string, branch: string): Git {
  const m = ctx.manifest;
  const path = worktreePathFor(ctx, area);
  const main = new Git(ctx.repoRoot);
  main.fetch(m.baseBranch);
  if (!existsSync(path)) {
    main.worktreeAdd(path, branch, `origin/${m.baseBranch}`);
    return new Git(path);
  }
  const wg = new Git(path);
  const current = wg.currentBranch();
  if (current !== branch) {
    if (current.endsWith(`/${area}`) && wg.commitsNotOn(m.baseBranch).length > 0) {
      throw new WorkkitError(
        'EFFORT_OPEN',
        `${current} holds ${wg.commitsNotOn(m.baseBranch).length} commit(s) not yet on ${m.baseBranch}: ship or finish it first, or --join it`,
        { branch: current, area },
      );
    }
    if (wg.isDirty())
      throw new WorkkitError(
        'DIRTY_WORKTREE',
        `${path} has uncommitted changes on ${current}; commit or park them before switching to ${branch}`,
        { worktree: path },
      );
    wg.checkout(branch, `origin/${m.baseBranch}`);
  }
  return wg;
}

function appendLog(file: string, line: string): void {
  appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
}

export async function startEffort(ctx: Ctx, o: StartOptions): Promise<StartResult> {
  const m = ctx.manifest;
  const { branch, scopes, commons, warnings } = guardStart(ctx, o);

  const active = ctx.registry.activeEffortFor(m.project, o.area);
  if (active) {
    if (!o.join) {
      throw new WorkkitError(
        'EFFORT_OPEN',
        `an effort is open on ${o.area} (${active.branch}, ${active.mode}) owned by ${active.owner.session} since ${active.started}; finish it, or pass --join to work in the same checkout`,
        { owner: active.owner.session, effort: active.id, branch: active.branch },
      );
    }
    const hours = {
      slot: m.expiry.slotHours,
      storybook: m.expiry.storybookHours,
      commons: m.expiry.commonsHours,
    };
    for (const l of ctx.registry.leases({ effort: active.id }))
      ctx.registry.touch(l.id, hours[l.kind]);
    ctx.registry.updateEffort(active.id, { lastActivity: now() });
    return {
      effort: active,
      leases: ctx.registry.leases({ effort: active.id }),
      sync: 'skipped',
      refreshed: [],
      marks: [],
      joined: true,
      warnings,
    };
  }

  const wg = ensureWorktree(ctx, o.area, branch);
  const worktree = wg.root();
  const logDir = join(worktree, m.logs.dir);
  mkdirSync(logDir, { recursive: true });
  const refreshLog = join(logDir, 'refresh.log');

  let sync: StartResult['sync'] = 'skipped';
  let changed: string[] = [];
  if (o.sync !== false) {
    wg.fetch(m.baseBranch);
    const r = wg.syncFrom(m.baseBranch);
    if (r.kind === 'conflict') {
      throw new WorkkitError(
        'SYNC_CONFLICT',
        `merging origin/${m.baseBranch} into ${branch} conflicts in ${r.conflicted.join(', ')}; resolve in ${worktree}, commit, then rerun with --no-sync`,
        { conflicted: r.conflicted, worktree },
      );
    }
    sync = r.kind;
    if (r.kind === 'ff' || r.kind === 'merge') changed = wg.changedPaths(r.before, r.after);
  }
  const sel = selectRefresh(m.refresh, changed);
  runRefresh(sel.runs, worktree, (l) => {
    appendLog(refreshLog, l);
    ctx.log(l);
  });

  const effortId = newId('eff');
  const leases: Lease[] = [];
  const release = () => {
    for (const l of leases) ctx.registry.release(l.id);
  };
  try {
    for (const name of commons)
      leases.push(
        ctx.registry.addLease(
          'commons',
          m.project,
          name,
          ctx.owner,
          effortId,
          m.expiry.commonsHours,
        ),
      );
    if (o.mode === 'fullstack') {
      const slot = ctx.registry.allocateSlot(m.project, m, ctx.owner, effortId);
      leases.push(slot);
      const cfg = emitWorktreeConfig({
        m,
        worktree,
        slot: slot.value as number,
        ports: slot.ports ?? {},
        area: o.area,
        branch,
      });
      const env = { ...process.env, ...cfg.vars };
      if (sel.marks.includes('db-reset') && m.services.postgres?.reset) {
        runRefresh([m.services.postgres.reset], worktree, (l) => appendLog(refreshLog, l), env);
      }
      const { pids } = await ctx.runner.start({ m, cwd: worktree, env, logDir, onLog: ctx.log });
      ctx.registry.patchLease(slot.id, { pids });
    } else {
      let storybookPort: number | undefined;
      if (o.story) {
        const hostRoot = m.storybook ? join(worktree, m.storybook.hostRoot) : worktree;
        const inst = await ctx.storybrokr.up(o.story, hostRoot);
        storybookPort = inst.port;
        leases.push(
          ctx.registry.addLease(
            'storybook',
            m.project,
            inst.id,
            ctx.owner,
            effortId,
            m.expiry.storybookHours,
            { ports: { storybook: inst.port } },
          ),
        );
      }
      emitWorktreeConfig({ m, worktree, ports: {}, storybookPort, area: o.area, branch });
    }
  } catch (err) {
    release();
    throw err;
  }

  const effort: Effort = {
    id: effortId,
    project: m.project,
    area: o.area,
    type: o.type,
    mode: o.mode,
    branch,
    worktree,
    owner: ctx.owner,
    state: 'active',
    scopes,
    commons,
    leases: leases.map((l) => l.id),
    notices: [],
    started: now(),
    lastActivity: now(),
  };
  ctx.registry.addEffort(effort);
  return {
    effort,
    leases: ctx.registry.leases({ effort: effortId }),
    sync,
    refreshed: sel.runs,
    marks: sel.marks,
    joined: false,
    warnings,
  };
}

// ── status / env ─────────────────────────────────────────────────────────────

export interface AreaStatus {
  area: string;
  effort?: Effort;
  leases: Lease[];
  /** commits on origin/<base> the area's branch does not have (0 without a worktree) */
  behindBase: number;
  notices: Notice[];
  worktree?: string;
}

export interface StatusReport {
  project: string;
  areas: AreaStatus[];
  leases: Lease[];
}

function latestEffortFor(ctx: Ctx, area: string): Effort | undefined {
  const all = ctx.registry.efforts({ project: ctx.manifest.project, area });
  return all.sort((a, b) => b.started.localeCompare(a.started))[0];
}

function behindBase(ctx: Ctx, worktree: string): number {
  if (!existsSync(worktree)) return 0;
  const g = new Git(worktree);
  g.tryRun(['fetch', '-q', 'origin', ctx.manifest.baseBranch]);
  const r = g.tryRun(['rev-list', '--count', `HEAD..origin/${ctx.manifest.baseBranch}`]);
  return r.code === 0 ? Number(r.out.trim()) || 0 : 0;
}

/** Every area of the project (or one), with its open effort, leases, drift from the base branch and notices. */
export function statusFor(ctx: Ctx, area?: string): StatusReport {
  const m = ctx.manifest;
  const names = (area ? [area] : Object.keys(m.areas)).sort();
  const areas: AreaStatus[] = names.map((name) => {
    const effort = ctx.registry.activeEffortFor(m.project, name);
    const latest = latestEffortFor(ctx, name);
    const worktree = worktreePathFor(ctx, name);
    const out: AreaStatus = {
      area: name,
      leases: effort ? ctx.registry.leases({ effort: effort.id }) : [],
      behindBase: behindBase(ctx, worktree),
      notices: latest?.notices ?? [],
    };
    if (effort) out.effort = effort;
    if (existsSync(worktree)) out.worktree = worktree;
    return out;
  });
  return { project: m.project, areas, leases: ctx.registry.leases({ project: m.project }) };
}

/** The slot-derived variables for a slot number alone: what a Makefile asks before any effort exists. */
export function slotEnv(m: Manifest, slot: number): Record<string, string> {
  return slotVars(m, { slot, ports: portsForSlot(m, slot) });
}

/** The variables the open effort's config was emitted with, plus MODE. */
export function effortEnv(ctx: Ctx, area: string): Record<string, string> {
  const m = ctx.manifest;
  const effort = ctx.registry.activeEffortFor(m.project, area);
  if (!effort)
    throw new WorkkitError(
      'EFFORT_NOT_FOUND',
      `no open effort on ${area}; \`work start --area ${area} …\` first`,
      { area },
    );
  const slot = ctx.registry.leases({ effort: effort.id, kind: 'slot' })[0];
  const sb = ctx.registry.leases({ effort: effort.id, kind: 'storybook' })[0];
  const vars = slotVars(m, {
    slot: slot ? (slot.value as number) : undefined,
    ports: slot?.ports ?? {},
    storybookPort: sb?.ports?.storybook,
    area,
    branch: effort.branch,
    worktree: effort.worktree,
    logDir: join(effort.worktree, m.logs.dir),
  });
  return { ...vars, MODE: effort.mode };
}
