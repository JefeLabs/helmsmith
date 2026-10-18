import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';

/** The repository's top level for `cwd`, or null outside a git work tree. */
export function repoRoot(cwd: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const top = r.stdout.trim();
  return top ? realpathOr(top) : null;
}

function realpathOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Directories to search for repository-level files, nearest first: `cwd`,
 * then each parent up to and including the repository root. Outside a
 * repository only `cwd` is searched, so nothing above the checkout is ever
 * picked up.
 */
export function searchDirs(cwd: string): string[] {
  const start = realpathOr(cwd);
  const root = repoRoot(start);
  if (!root) return [start];
  const dirs: string[] = [];
  let dir = start;
  while (true) {
    dirs.push(dir);
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break; // never reached the root: cwd is not under it
    dir = parent;
  }
  return dirs;
}
