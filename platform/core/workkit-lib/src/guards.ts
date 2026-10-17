import { WorkkitError } from './errors.js';
import type { Git } from './git.js';
import type { Registry } from './registry.js';
import { commonsTouched, pathsMatching } from './scopes.js';
import type { Manifest } from './types.js';

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

export interface CommitCheck {
  m: Manifest;
  registry: Registry;
  git: Git;
  project: string;
  branch: string;
  stagedPaths: string[];
  ownerSession: string;
}

/** What a pre-commit hook asks: may this commit be made? Refusals are sentences for stderr. */
export function checkCommit(c: CommitCheck): { refusals: string[] } {
  const refusals: string[] = [];
  if (c.m.protectedBranches.includes(c.branch)) {
    refusals.push(
      `branch "${c.branch}" is protected (${c.m.protectedBranches.join(', ')}): work happens on <type>/<area> branches, never here`,
    );
  }
  for (const lease of c.registry.leases({ project: c.project, kind: 'commons' })) {
    if (lease.owner.session === c.ownerSession) continue;
    const globs = c.m.commons[String(lease.value)] ?? [];
    const hit = pathsMatching(c.stagedPaths, globs);
    if (hit.length > 0) {
      refusals.push(
        `commons "${lease.value}" is write-locked by ${lease.owner.session} (effort ${lease.effort}, since ${lease.touched}); staged: ${hit.join(', ')}`,
      );
    }
  }
  return { refusals };
}

export interface PushCheck {
  m: Manifest;
  registry: Registry;
  git: Git;
  project: string;
  branch: string;
  changedPaths: string[];
}

/** What a pre-push hook asks: protected → refusal; leaving the scope or touching commons → warnings. */
export function checkPush(c: PushCheck): { refusals: string[]; warnings: string[] } {
  const refusals: string[] = [];
  const warnings: string[] = [];
  if (c.m.protectedBranches.includes(c.branch)) {
    refusals.push(
      `branch "${c.branch}" is protected (${c.m.protectedBranches.join(', ')}): nothing is pushed to it directly`,
    );
    return { refusals, warnings };
  }
  const effort = c.registry
    .efforts({ project: c.project, state: 'active' })
    .find((e) => e.branch === c.branch);
  const commons = commonsTouched(c.m, c.changedPaths);
  if (effort) {
    const allCommonsGlobs = Object.values(c.m.commons).flat();
    const inScope = new Set(pathsMatching(c.changedPaths, [...effort.scopes, ...allCommonsGlobs]));
    const outside = c.changedPaths.filter((p) => !inScope.has(p));
    if (outside.length > 0) {
      warnings.push(
        `${outside.length} changed path(s) are outside the effort's scope (${effort.area}): ${outside.join(', ')} — add a scope template or expect a merge collision`,
      );
    }
  }
  for (const name of commons) {
    warnings.push(`commons ${name} touched: the other areas are told at \`work finish\``);
  }
  return { refusals, warnings };
}
