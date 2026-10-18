import { existsSync, realpathSync } from 'node:fs';
import { WorkkitError } from './errors.js';
import type { Git } from './git.js';
import type { Registry } from './registry.js';
import { allowedScopesForEffort, commonsTouched, pathsMatching } from './scopes.js';
import type { Effort, Manifest } from './types.js';

export function assertNotProtected(m: Manifest, branch: string): void {
  if (m.protectedBranches.includes(branch)) {
    throw new WorkkitError(
      'PROTECTED_BRANCH',
      `branch "${branch}" is protected (${m.protectedBranches.join(', ')}): work happens on <type>/<area> branches, never here`,
      { branch },
    );
  }
}

export function assertNotMainCheckout(git: Git): void {
  if (git.isMainCheckout()) {
    throw new WorkkitError(
      'MAIN_CHECKOUT',
      `${git.cwd} is the main checkout, which is a mirror of the base branch: run \`work start\` to get an area worktree`,
      { cwd: git.cwd },
    );
  }
}

const same = (a: string, b: string) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};

const effortLabel = (e: Pick<Effort, 'area' | 'task'>) =>
  e.task ? `${e.area}--${e.task}` : e.area;

export interface CommitCheck {
  m: Manifest;
  registry: Registry;
  git: Git;
  project: string;
  branch: string;
  stagedPaths: string[];
  ownerSession: string;
  /** the committing checkout's top level: a lock held by the effort living there is the committer's own */
  checkoutRoot?: string;
}

/** What a pre-commit hook asks: may this commit be made? Refusals are sentences for stderr. */
export function checkCommit(c: CommitCheck): { refusals: string[]; warnings: string[] } {
  const refusals: string[] = [];
  const warnings: string[] = [];
  if (c.m.protectedBranches.includes(c.branch)) {
    refusals.push(
      `branch "${c.branch}" is protected (${c.m.protectedBranches.join(', ')}): work happens on <type>/<area> branches, never here`,
    );
  }
  // Resolving a merge stages everything the other parent brought in. Those paths are
  // not this effort's writes: scope and commons checks look only at paths whose staged
  // content differs from MERGE_HEAD (authored here, or a conflict resolved by hand).
  const mergeHead = c.git.mergeHead();
  const authored = mergeHead
    ? new Set(c.git.stagedDifferingFrom(mergeHead, c.stagedPaths))
    : new Set(c.stagedPaths);
  const ownPaths = c.stagedPaths.filter((p) => authored.has(p));
  const allEfforts = c.registry.efforts({ project: c.project });
  const efforts = new Map(allEfforts.map((e) => [e.id, e]));
  const openEfforts = allEfforts.filter((e) => e.state === 'active' || e.state === 'starting');
  const mine = openEfforts.find((e) =>
    c.checkoutRoot && existsSync(e.worktree)
      ? same(e.worktree, c.checkoutRoot)
      : e.branch === c.branch,
  );
  for (const lease of c.registry.leases({ project: c.project, kind: 'commons' })) {
    const holder = efforts.get(lease.effort);
    const holderHasWorktree = Boolean(holder && existsSync(holder.worktree));
    if (holder && holderHasWorktree && c.checkoutRoot) {
      if (same(holder.worktree, c.checkoutRoot)) continue;
    } else if (lease.owner.session === c.ownerSession) {
      continue;
    }
    // every effort of the area that owns the commons holds the same lease: its tasks share it
    if (holder && mine && holder.area === mine.area) continue;
    const globs = c.m.commons[String(lease.value)] ?? [];
    const hit = pathsMatching(ownPaths, globs);
    if (hit.length > 0) {
      refusals.push(
        `commons "${lease.value}" is write-locked by ${lease.owner.session} (effort ${lease.effort}, since ${lease.touched}); staged: ${hit.join(', ')}`,
      );
    }
  }
  for (const other of openEfforts) {
    if (c.checkoutRoot && existsSync(other.worktree) && same(other.worktree, c.checkoutRoot)) {
      continue;
    }
    if (!c.checkoutRoot && other.branch === c.branch) continue;
    const hit = pathsMatching(ownPaths, other.scopes);
    if (hit.length > 0) {
      refusals.push(
        `path(s) ${hit.join(', ')} are inside the active scope of ${effortLabel(other)} (${other.branch}, owned by ${other.owner.session})`,
      );
    }
  }
  if (mine && ownPaths.length > 0) {
    const allowed = allowedScopesForEffort(c.m, mine);
    const inScope = new Set(pathsMatching(ownPaths, allowed));
    const outside = ownPaths.filter((p) => !inScope.has(p));
    if (outside.length > 0) {
      warnings.push(
        `${outside.length} staged path(s) are outside the effort's scope (${effortLabel(mine)}): ${outside.join(', ')}`,
      );
    }
  }
  return { refusals, warnings };
}

export interface PushCheck {
  m: Manifest;
  registry: Registry;
  git: Git;
  project: string;
  /** the local branch being pushed ('' for a delete) */
  branch: string;
  /** the destination ref (`refs/heads/<name>`); absent = same name as the local branch */
  remoteRef?: string;
  isDelete?: boolean;
  changedPaths: string[];
}

/** What a pre-push hook asks: a protected destination → refusal; leaving the scope or touching commons → warnings. */
export function checkPush(c: PushCheck): { refusals: string[]; warnings: string[] } {
  const refusals: string[] = [];
  const warnings: string[] = [];
  const destination = (c.remoteRef ?? `refs/heads/${c.branch}`).replace(/^refs\/heads\//, '');
  if (c.m.protectedBranches.includes(destination)) {
    refusals.push(
      c.isDelete
        ? `refusing to delete protected branch "${destination}"`
        : `"${destination}" is protected (${c.m.protectedBranches.join(', ')}): nothing is pushed to it directly, open a PR from ${c.branch || 'an area branch'}`,
    );
    return { refusals, warnings };
  }
  if (c.isDelete) return { refusals, warnings };
  const effort = c.registry
    .efforts({ project: c.project })
    .find((e) => (e.state === 'active' || e.state === 'parked') && e.branch === c.branch);
  const commons = commonsTouched(c.m, c.changedPaths);
  if (effort) {
    const allowed = allowedScopesForEffort(c.m, effort);
    const inScope = new Set(pathsMatching(c.changedPaths, allowed));
    const outside = c.changedPaths.filter((p) => !inScope.has(p));
    if (outside.length > 0) {
      warnings.push(
        `${outside.length} changed path(s) are outside the effort's scope (${effortLabel(effort)}): ${outside.join(', ')} — add a scope template or expect a merge collision`,
      );
    }
  }
  for (const name of commons)
    warnings.push(`commons ${name} touched: the other areas are told at \`work finish\``);
  return { refusals, warnings };
}
