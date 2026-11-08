/**
 * `merge`/`pick --json`: the no-prompt flows (spec §5). Each repo ends either done or
 * exactly where it started, and its report row says which. Anything that fails after
 * git has started an operation is rolled back before the row is written; every repo
 * runs inside `withRepoGuard`, which restores the start branch and stash.
 *
 * The text-mode flows (`Orchestrator.executeMerge`/`executeCherryPick`) are untouched.
 */
import { APP_NAME } from '../config/branding.js';
import type { AiMode, CherryPickTarget, MergeTarget, RepoConfig } from '../config/schema.js';
import type { MergePickDocument, MergePickRow, PrRow } from '../output/contract.js';
import {
  type AgentAvailability,
  checkAgentAvailable,
  createCopilotAgent,
} from './copilot-agent.js';
import type { GitOperations } from './git-operations.js';
import { type HeadlessAgent, resolveConflictsHeadless } from './headless-resolver.js';

// ─── agent ─────────────────────────────────────────────────────────

/**
 * Effective mode (spec §5.1): the flag, else the manifest. A manifest `suggest` (the
 * schema default, meant for people) reads as "AI allowed"; `manual` is an explicit
 * opt-out and is honoured. The CLI refuses a `suggest` flag before calling this.
 */
export function resolveAgentMode(
  flag: AiMode | undefined,
  manifestMode: AiMode,
): { mode: 'auto' | 'manual'; modeSource: 'flag' | 'manifest' } {
  const chosen = flag ?? manifestMode;
  return { mode: chosen === 'manual' ? 'manual' : 'auto', modeSource: flag ? 'flag' : 'manifest' };
}

export interface AgentSetup extends HeadlessAgent {
  modeSource: 'flag' | 'manifest';
  model: string;
  /** `null` in manual mode: nothing was checked. */
  available: boolean | null;
}

export async function setupAgent(
  mode: 'auto' | 'manual',
  modeSource: 'flag' | 'manifest',
  model: string,
  deps: {
    check: () => Promise<AgentAvailability>;
    make: typeof createCopilotAgent;
  } = { check: checkAgentAvailable, make: createCopilotAgent },
): Promise<AgentSetup> {
  const base = { mode, modeSource, model };
  if (mode === 'manual') return { ...base, available: null, reply: null };
  const availability = await deps.check();
  if (availability.available) return { ...base, available: true, reply: deps.make(model) };
  return { ...base, available: false, reply: null, unavailableReason: availability.reason };
}

/** The trailer on every commit carrying agent-written content (spec §5.3). */
export function resolvedByTrailer(model: string): string {
  return `Resolved-by: ${APP_NAME} agent (${model})`;
}

// ─── shared per-repo steps ─────────────────────────────────────────

export interface RunDeps {
  getGit: (repo: RepoConfig) => GitOperations;
  agent: AgentSetup;
}

export interface RunOptions {
  fetch: boolean;
  push: boolean;
  pr: boolean;
}

interface RepoTarget {
  repo: RepoConfig;
  sourceBranch: string;
  targetBranch: string;
}

const firstLine = (err: unknown) =>
  (err instanceof Error ? err.message : String(err))
    .split('\n')
    .find((l) => l.trim())
    ?.trim() ?? 'unknown error';

function newRow(t: RepoTarget): MergePickRow {
  return {
    repo: t.repo.name,
    sourceRef: t.sourceBranch,
    targetRef: t.targetBranch,
    status: 'error',
    message: '',
    resolvedBy: null,
    conflicts: [],
    rolledBack: false,
    head: null,
    pushed: false,
    pr: null,
  };
}

/** A branch's tip. Through `refs/heads/`: plain `rev-parse <name>` prefers a tag with
 *  the same name, which made `head` and "already contains" wrong. */
function branchTip(git: GitOperations, branch: string): Promise<string> {
  return git.revParse(`refs/heads/${branch}`);
}

async function headOf(git: GitOperations, branch: string): Promise<string | null> {
  return branchTip(git, branch).catch(() => null);
}

/** C2: a repo that can't even be opened (path gone) is its own error row, never the run's. */
function openRepo(deps: RunDeps, t: RepoTarget, row: MergePickRow): GitOperations | null {
  try {
    return deps.getGit(t.repo);
  } catch (err) {
    fail(row, 'error', firstLine(err));
    return null;
  }
}

function fail(row: MergePickRow, status: 'error' | 'skipped', error: string): void {
  row.status = status;
  row.error = error;
  row.message = error;
}

/** Pre-fetch (spec §5.1): a repo whose fetch fails is not touched; its row is `skipped`. */
async function prefetch(
  git: GitOperations,
  row: MergePickRow,
  t: RepoTarget,
  opts: RunOptions,
): Promise<boolean> {
  if (!opts.fetch) return true;
  try {
    await git.fetch(t.repo.remote);
    return true;
  } catch (err) {
    fail(row, 'skipped', `fetch failed: ${firstLine(err)}`);
    row.head = await headOf(git, t.targetBranch);
    return false;
  }
}

/** A failed push turns the row into an error; the commits stay applied locally. */
async function pushIfAsked(
  git: GitOperations,
  row: MergePickRow,
  t: RepoTarget,
  opts: RunOptions,
): Promise<void> {
  if (!opts.push || row.status !== 'success') return;
  try {
    await git.push(t.repo.remote, t.targetBranch);
    row.pushed = true;
  } catch (err) {
    fail(row, 'error', `push failed: ${firstLine(err)}`);
  }
}

/**
 * `--pr` is reported, never swallowed (spec §5.4). JSON mode resolves in place, so the
 * head would be the target branch itself: skipped until hardening §3.5's `--branch`.
 */
function prRow(row: MergePickRow, operation: 'merge' | 'pick'): PrRow {
  if (row.status !== 'success') {
    return {
      status: 'skipped',
      reason: `repo was not ${operation === 'merge' ? 'merged' : 'picked'} (${row.status})`,
    };
  }
  return { status: 'skipped', reason: 'head equals base; needs --branch (hardening §3.5)' };
}

async function finishRow(
  git: GitOperations,
  row: MergePickRow,
  t: RepoTarget,
  opts: RunOptions,
  operation: 'merge' | 'pick',
): Promise<void> {
  await pushIfAsked(git, row, t, opts);
  row.pr = opts.pr ? prRow(row, operation) : null;
}

// ─── merge ─────────────────────────────────────────────────────────

export async function runMergeJson(
  targets: MergeTarget[],
  deps: RunDeps,
  opts: RunOptions,
): Promise<MergePickRow[]> {
  const rows: MergePickRow[] = [];
  for (const t of targets) {
    const row = newRow(t);
    rows.push(row);
    const git = openRepo(deps, t, row);
    if (!git) {
      row.pr = opts.pr ? prRow(row, 'merge') : null;
      continue;
    }
    if (await prefetch(git, row, t, opts)) {
      await mergeOne(git, row, t, deps.agent);
    }
    await finishRow(git, row, t, opts, 'merge');
  }
  return rows;
}

async function mergeOne(
  git: GitOperations,
  row: MergePickRow,
  t: MergeTarget,
  agent: AgentSetup,
): Promise<void> {
  const { sourceBranch: source, targetBranch: target } = t;
  try {
    await git.withRepoGuard(
      `merge ${source} → ${target} (${t.repo.name})`,
      async () => {
        const before = await branchTip(git, target);
        let merged: { success: boolean };
        try {
          merged = await git.merge(source, target);
        } catch (err) {
          // git can start a merge and then fail (the merge commit can't be signed, rerere
          // auto-staged everything): abort it so the guard can restore the start branch.
          if (await git.mergeInProgress()) {
            await git.abortMerge();
            row.rolledBack = true;
          }
          throw err;
        }
        if (merged.success) {
          row.status = 'success';
          row.message =
            (await branchTip(git, target)) === before
              ? `${target} already contains ${source}`
              : `Merged ${source} → ${target}`;
        } else {
          await resolveOrRollBack(git, row, agent, source, target);
        }
        row.head = await branchTip(git, target);
      },
      (problem) => {
        row.notRestored = problem;
      },
    );
  } catch (err) {
    fail(row, 'error', firstLine(err));
    row.head = await headOf(git, target);
  }
}

/** Agent first; any file left unresolved, or any error, aborts the merge. */
async function resolveOrRollBack(
  git: GitOperations,
  row: MergePickRow,
  agent: AgentSetup,
  source: string,
  target: string,
): Promise<void> {
  try {
    const result = await resolveConflictsHeadless(git, agent);
    row.conflicts = result.conflicts;
    if (result.resolved) {
      await git.finishResolvedCommit(resolvedByTrailer(agent.model));
      row.status = 'success';
      row.resolvedBy = 'agent';
      row.message = `Merged ${source} → ${target}; the agent resolved ${result.conflicts.length} file(s)`;
      return;
    }
    await git.abortMerge();
    row.rolledBack = true;
    row.status = 'conflict';
    const open = result.conflicts.filter((c) => c.outcome !== 'resolved').length;
    row.message = `${open} conflicted file(s) not resolved; merge rolled back`;
  } catch (err) {
    try {
      await git.abortMerge();
      row.rolledBack = true;
    } catch {
      /* the guard reports what it could not restore */
    }
    throw err;
  }
}

// ─── pick ──────────────────────────────────────────────────────────

export async function runPickJson(
  targets: CherryPickTarget[],
  deps: RunDeps,
  opts: RunOptions,
): Promise<MergePickRow[]> {
  const rows: MergePickRow[] = [];
  for (const t of targets) {
    const row: MergePickRow = {
      ...newRow(t),
      commits: { requested: [...t.commits], applied: [], dropped: [] },
    };
    rows.push(row);
    const git = openRepo(deps, t, row);
    if (!git) {
      row.pr = opts.pr ? prRow(row, 'pick') : null;
      continue;
    }
    if (await prefetch(git, row, t, opts)) {
      await pickOneRepo(git, row, t, deps.agent);
    }
    await finishRow(git, row, t, opts, 'pick');
  }
  return rows;
}

async function pickOneRepo(
  git: GitOperations,
  row: MergePickRow,
  t: CherryPickTarget,
  agent: AgentSetup,
): Promise<void> {
  const commits = row.commits as NonNullable<MergePickRow['commits']>;
  const target = t.targetBranch;

  // Resolve every requested commit first: a sha this repo lacks is refused before
  // anything is touched (spec §5.1: the same SHAs go to every repo in the target).
  const full: string[] = [];
  for (const sha of t.commits) {
    try {
      full.push(await git.revParse(sha));
    } catch {
      fail(row, 'error', `commit ${sha} not found in ${t.repo.name}`);
      row.head = await headOf(git, target);
      return;
    }
  }

  try {
    await git.withRepoGuard(
      `cherry-pick → ${target} (${t.repo.name})`,
      async () => {
        await git.switchToBranch(target);
        const preSha = await git.revParse('HEAD');
        // Undo this run's picks (spec §5.2). Safe because withRepoGuard guaranteed a clean
        // tree on entry and preSha was recorded by this run on this branch; refuse rather
        // than reset if HEAD somehow no longer descends from it.
        const undo = async () => {
          await git.cherryPickAbort().catch(() => {});
          if (!(await git.isAncestor(preSha, 'HEAD'))) {
            throw new Error(`HEAD no longer descends from ${preSha}; not resetting`);
          }
          await git.resetHard(preSha);
          row.rolledBack = true;
          commits.applied = [];
          row.resolvedBy = null;
        };

        try {
          for (const sha of full) {
            const outcome = await git.pickOne(sha);
            if (outcome === 'applied') commits.applied.push(sha);
            else if (outcome === 'dropped') commits.dropped.push(sha);
            else {
              const result = await resolveConflictsHeadless(git, agent, sha);
              row.conflicts.push(...result.conflicts);
              if (!result.resolved) {
                row.stoppedAt = sha;
                await undo();
                row.status = 'conflict';
                row.message = `conflict at ${sha.slice(0, 8)} not resolved; pick rolled back`;
                break;
              }
              await git.finishResolvedCommit(resolvedByTrailer(agent.model), sha);
              commits.applied.push(sha);
              row.resolvedBy = 'agent';
            }
          }
          if (row.status !== 'conflict') {
            row.status = 'success';
            row.message = `Applied ${commits.applied.length} commit(s) to ${target}${
              commits.dropped.length ? `; ${commits.dropped.length} already present` : ''
            }`;
          }
        } catch (err) {
          try {
            await undo();
          } catch (undoErr) {
            throw new Error(`${firstLine(err)}; rollback failed: ${firstLine(undoErr)}`);
          }
          throw err;
        }
        row.head = await branchTip(git, target);
      },
      (problem) => {
        row.notRestored = problem;
      },
    );
  } catch (err) {
    fail(row, 'error', firstLine(err));
    row.head = await headOf(git, target);
  }
}

// ─── document ──────────────────────────────────────────────────────

export function toMergePickDocument(
  operation: 'merge' | 'pick',
  source: string,
  target: string,
  agent: AgentSetup,
  rows: MergePickRow[],
): MergePickDocument {
  const count = (s: MergePickRow['status']) => rows.filter((r) => r.status === s).length;
  return {
    operation,
    source,
    target,
    agent: {
      mode: agent.mode,
      modeSource: agent.modeSource,
      model: agent.model,
      available: agent.available,
    },
    repos: rows,
    summary: {
      repos: rows.length,
      success: count('success'),
      conflict: count('conflict'),
      error: count('error'),
      skipped: count('skipped'),
    },
  };
}
