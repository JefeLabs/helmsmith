/**
 * `merge`/`pick --json`: the no-prompt flows (spec §5). Each repo ends either done or
 * exactly where it started, and its report row says which. Anything that fails after
 * git has started an operation is rolled back before the row is written; every repo
 * runs inside `withRepoGuard`, which restores the start branch and stash.
 *
 * The text-mode flows (`Orchestrator.executeMerge`/`executeCherryPick`) are untouched.
 */
import { APP_NAME } from '../config/branding.js';
import type { AiMode, MergeTarget, RepoConfig } from '../config/schema.js';
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

async function headOf(git: GitOperations, ref: string): Promise<string | null> {
  return git.revParse(ref).catch(() => null);
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
    const git = deps.getGit(t.repo);
    const row = newRow(t);
    rows.push(row);
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
    await git.withRepoGuard(`merge ${source} → ${target} (${t.repo.name})`, async () => {
      const before = await git.revParse(target);
      const merged = await git.merge(source, target);
      if (merged.success) {
        row.status = 'success';
        row.message =
          (await git.revParse(target)) === before
            ? `${target} already contains ${source}`
            : `Merged ${source} → ${target}`;
      } else {
        await resolveOrRollBack(git, row, agent, source, target);
      }
      row.head = await git.revParse(target);
    });
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
