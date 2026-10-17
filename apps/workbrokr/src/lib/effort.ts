import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  assertNotProtected,
  commonsTouched,
  type Effort,
  emitWorktreeConfig,
  ensureExcluded,
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

// ── finish / reap ────────────────────────────────────────────────────────────

function leaseEnv(ctx: Ctx, effort: Effort, lease: Lease): NodeJS.ProcessEnv {
  const vars = slotVars(ctx.manifest, {
    slot: lease.kind === 'slot' ? (lease.value as number) : undefined,
    ports: lease.ports ?? {},
    area: effort.area,
    branch: effort.branch,
    worktree: effort.worktree,
    logDir: join(effort.worktree, ctx.manifest.logs.dir),
  });
  return { ...process.env, ...vars };
}

/** Stop what a lease started (and only that), bring its Storybook down, release it. */
async function releaseLease(ctx: Ctx, effort: Effort | undefined, lease: Lease): Promise<void> {
  try {
    if (lease.kind === 'slot' && lease.pids && effort && existsSync(effort.worktree)) {
      await ctx.runner.stop({
        m: ctx.manifest,
        cwd: effort.worktree,
        env: leaseEnv(ctx, effort, lease),
        pids: lease.pids,
        onLog: ctx.log,
      });
    } else if (lease.kind === 'storybook') {
      await ctx.storybrokr.down(String(lease.value));
    }
  } catch (err) {
    ctx.log(
      `while releasing ${lease.kind} ${lease.value}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  ctx.registry.release(lease.id);
}

/** Tell every other area that a commons set changed on this branch (informational only). */
function leaveNotices(ctx: Ctx, effort: Effort, commons: string[]): number {
  if (commons.length === 0) return 0;
  const m = ctx.manifest;
  const notice: Notice = {
    from: effort.branch,
    text: `commons ${commons.join(', ')} changed on ${effort.branch}: sync and re-verify`,
    at: now(),
  };
  let count = 0;
  for (const area of Object.keys(m.areas)) {
    if (area === effort.area) continue;
    const latest = latestEffortFor(ctx, area);
    if (latest) ctx.registry.updateEffort(latest.id, { notices: [...latest.notices, notice] });
    else {
      ctx.registry.addEffort({
        id: newId('eff'),
        project: m.project,
        area,
        type: '-',
        mode: 'frontend',
        branch: '',
        worktree: worktreePathFor(ctx, area),
        owner: ctx.owner,
        state: 'finished',
        scopes: [],
        commons: [],
        leases: [],
        notices: [notice],
        started: now(),
        lastActivity: now(),
      });
    }
    count++;
  }
  return count;
}

export interface FinishResult {
  effort: Effort;
  pushed: boolean;
  parked: boolean;
  notices: number;
}

/** Stop the runner, release every lease, push the branch, leave notices; the worktree and branch stay. */
export async function finishEffort(
  ctx: Ctx,
  o: { area: string; park?: boolean },
): Promise<FinishResult> {
  const m = ctx.manifest;
  const effort = ctx.registry.activeEffortFor(m.project, o.area);
  if (!effort)
    throw new WorkkitError('EFFORT_NOT_FOUND', `no open effort on ${o.area}`, { area: o.area });
  const g = new Git(effort.worktree);
  let parked = false;
  if (g.isDirty()) {
    if (!o.park) {
      throw new WorkkitError(
        'DIRTY_WORKTREE',
        `${effort.worktree} has uncommitted changes: commit them, or \`work finish --park\` to commit them as wip(${effort.area}) and push`,
        { worktree: effort.worktree },
      );
    }
    g.run(['add', '-A']);
    g.run(['commit', '-q', '-m', `wip(${effort.area}): parked ${now()}`]);
    parked = true;
  }
  for (const lease of ctx.registry.leases({ effort: effort.id }))
    await releaseLease(ctx, effort, lease);
  g.push(effort.branch);
  const changed = g.changedPaths(`origin/${m.baseBranch}`, 'HEAD');
  const notices = leaveNotices(ctx, effort, commonsTouched(m, changed));
  const finished = ctx.registry.updateEffort(effort.id, { state: 'finished', lastActivity: now() });
  return { effort: finished, pushed: true, parked, notices };
}

/** Expire idle leases: stop only what they started, release them, park their efforts. */
export async function reapLeases(
  ctx: Ctx,
  o: { dryRun?: boolean; now?: Date } = {},
): Promise<{ reaped: Lease[] }> {
  const m = ctx.manifest;
  const at = o.now ?? new Date();
  const efforts = new Map(ctx.registry.efforts({ project: m.project }).map((e) => [e.id, e]));
  const reaped = ctx.registry
    .leases({ project: m.project })
    .filter(
      (l) =>
        Date.parse(l.expires) < at.getTime() ||
        !existsSync(efforts.get(l.effort)?.worktree ?? '/nonexistent'),
    );
  if (o.dryRun) return { reaped };
  for (const lease of reaped) {
    const effort = efforts.get(lease.effort);
    await releaseLease(ctx, effort, lease);
    if (effort && effort.state === 'active') {
      ctx.registry.updateEffort(effort.id, {
        state: 'parked',
        parkedReason: `idle: ${lease.kind} lease expired ${lease.expires}`,
        lastActivity: now(),
      });
      efforts.set(effort.id, { ...effort, state: 'parked' });
    }
  }
  return { reaped };
}

// ── retire / audit ───────────────────────────────────────────────────────────

export const ARCHIVE_DIR = '.slot-archive';
const areaSlug = (area: string) => area.replace(/\//g, '-');

function dirSize(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const p = join(path, entry.name);
    total += entry.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

/** Copy the manifest's evidence paths out of the worktree, then apply the retention rule for this area. */
function archiveWorktree(ctx: Ctx, area: string, worktree: string): string[] {
  const m = ctx.manifest;
  const root = join(ctx.repoRoot, ARCHIVE_DIR);
  const stamp = now().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
  const target = join(root, `${areaSlug(area)}-${stamp}`);
  const archived: string[] = [];
  for (const rel of m.archive.paths) {
    const src = join(worktree, rel);
    if (!existsSync(src)) continue;
    const dst = join(target, rel);
    mkdirSync(dst, { recursive: true });
    cpSync(src, dst, { recursive: true });
    archived.push(dst);
  }
  if (archived.length > 0) ensureExcluded(ctx.repoRoot, [`${ARCHIVE_DIR}/`]);
  if (existsSync(root)) {
    const mine = readdirSync(root)
      .filter((d) => d.startsWith(`${areaSlug(area)}-`))
      .sort()
      .reverse();
    const cutoff = Date.now() - m.archive.keepDays * 86_400_000;
    mine.forEach((d, i) => {
      const t = statSync(join(root, d)).mtimeMs;
      if (i >= m.archive.keepPerArea || t < cutoff)
        rmSync(join(root, d), { recursive: true, force: true });
    });
  }
  return archived;
}

export interface RetireResult {
  archived: string[];
  removed: string;
  branchesDeleted: string[];
  branchesKept: string[];
}

/** The only destructive verb: archive, remove the worktree, delete the local branches that are fully on origin. */
export async function retireArea(ctx: Ctx, o: { area: string }): Promise<RetireResult> {
  const m = ctx.manifest;
  if (!m.areas[o.area])
    throw new WorkkitError('AREA_UNKNOWN', `unknown area "${o.area}"`, { area: o.area });
  const active = ctx.registry.activeEffortFor(m.project, o.area);
  if (active)
    throw new WorkkitError(
      'EFFORT_OPEN',
      `an effort is open on ${o.area} (${active.owner.session}); \`work finish\` it first`,
      { owner: active.owner.session },
    );
  const worktree = worktreePathFor(ctx, o.area);
  const main = new Git(ctx.repoRoot);
  let archived: string[] = [];
  if (existsSync(worktree)) {
    const g = new Git(worktree);
    if (g.isDirty())
      throw new WorkkitError(
        'UNPUSHED',
        `${worktree} has uncommitted changes; commit and push them (or \`work finish --park\`) before retiring`,
        { worktree },
      );
    const unpushed = g.unpushedCount(m.baseBranch);
    if (unpushed > 0)
      throw new WorkkitError(
        'UNPUSHED',
        `${g.currentBranch()} has ${unpushed} commit(s) not on origin; push before retiring`,
        { worktree, unpushed },
      );
    archived = archiveWorktree(ctx, o.area, worktree);
    main.worktreeRemove(worktree);
  }
  const branchesDeleted: string[] = [];
  const branchesKept: string[] = [];
  for (const type of m.branch.types) {
    const branch = `${type}/${o.area}`;
    if (!main.branchExists(branch)) continue;
    const onOrigin =
      main.remoteBranchExists(branch) &&
      main.tryRun(['rev-list', '--count', `origin/${branch}..${branch}`]).out.trim() === '0';
    if (onOrigin) {
      main.deleteLocalBranch(branch);
      branchesDeleted.push(branch);
    } else branchesKept.push(branch);
  }
  ctx.registry.removeEfforts((e) => e.project === m.project && e.area === o.area);
  return { archived, removed: worktree, branchesDeleted, branchesKept };
}

export type FindingKind =
  | 'dirty'
  | 'unpushed'
  | 'foreign-branch'
  | 'lease-aging'
  | 'behind-base'
  | 'notice-stale'
  | 'archive-size';
export interface Finding {
  kind: FindingKind;
  area?: string;
  detail: string;
}

const BEHIND_LIMIT = 20;
const NOTICE_STALE_MS = 7 * 86_400_000;
const ARCHIVE_LIMIT_BYTES = 5 * 1024 ** 3;

function registeredWorktrees(ctx: Ctx): { path: string; branch: string }[] {
  const out: { path: string; branch: string }[] = [];
  const porcelain = new Git(ctx.repoRoot).run(['worktree', 'list', '--porcelain']);
  let current: { path: string; branch: string } | null = null;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) current = { path: line.slice(9), branch: '' };
    else if (line.startsWith('branch ') && current)
      current.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === '' && current) {
      out.push(current);
      current = null;
    }
  }
  if (current) out.push(current);
  const root = realpathSync(ctx.repoRoot);
  const wtRoot = join(root, ctx.manifest.worktreeRoot);
  return out.filter((w) => existsSync(w.path) && realpathSync(w.path).startsWith(wtRoot));
}

/** What would otherwise be forgotten: unsaved work, stray checkouts, aging leases, drift, stale notices, archive bulk. */
export async function auditProject(ctx: Ctx): Promise<Finding[]> {
  const m = ctx.manifest;
  const findings: Finding[] = [];
  const types = m.branch.types.join('|');
  const areaOf = (branch: string): string | null => {
    const match = new RegExp(`^(${types})/(.+)$`).exec(branch);
    return match && m.areas[match[2]] ? match[2] : null;
  };
  for (const w of registeredWorktrees(ctx)) {
    const area = areaOf(w.branch);
    if (!area) {
      findings.push({
        kind: 'foreign-branch',
        detail: `${w.path} is on "${w.branch || 'detached HEAD'}", not a <type>/<area> branch of a declared area`,
      });
      continue;
    }
    const g = new Git(w.path);
    if (g.isDirty())
      findings.push({
        kind: 'dirty',
        area,
        detail: `${w.path} has uncommitted changes on ${w.branch}`,
      });
    const unpushed = g.unpushedCount(m.baseBranch);
    if (unpushed > 0)
      findings.push({
        kind: 'unpushed',
        area,
        detail: `${w.branch} has ${unpushed} commit(s) not on origin`,
      });
    const behind = behindBase(ctx, w.path);
    if (behind > BEHIND_LIMIT)
      findings.push({
        kind: 'behind-base',
        area,
        detail: `${w.branch} is ${behind} commits behind ${m.baseBranch}`,
      });
  }
  const nowMs = Date.now();
  for (const l of ctx.registry.leases({ project: m.project })) {
    const half = (Date.parse(l.created) + Date.parse(l.expires)) / 2;
    if (nowMs > half)
      findings.push({
        kind: 'lease-aging',
        detail: `${l.kind} ${l.value} held by ${l.owner.session} since ${l.created}, expires ${l.expires}`,
      });
  }
  for (const area of Object.keys(m.areas)) {
    const latest = latestEffortFor(ctx, area);
    for (const n of latest?.notices ?? []) {
      if (nowMs - Date.parse(n.at) > NOTICE_STALE_MS)
        findings.push({ kind: 'notice-stale', area, detail: `${n.text} (since ${n.at})` });
    }
  }
  const bytes = dirSize(join(ctx.repoRoot, ARCHIVE_DIR));
  if (bytes > ARCHIVE_LIMIT_BYTES)
    findings.push({
      kind: 'archive-size',
      detail: `${ARCHIVE_DIR} holds ${(bytes / 1024 ** 3).toFixed(1)} GB`,
    });
  return findings;
}
