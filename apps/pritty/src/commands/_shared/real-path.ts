import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

/**
 * Real path of `p` even when it does not exist yet: its nearest existing
 * ancestor, realpath'd, joined with the missing rest. Null when a component on
 * the way exists but cannot be resolved (a dangling symlink).
 */
export function realOfNearest(p: string): string | null {
  const rest: string[] = [];
  let cur = resolve(p);
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest.reverse());
    } catch {
      try {
        lstatSync(cur);
        return null; // exists but cannot be resolved: a dangling symlink
      } catch {
        // does not exist: climb
      }
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    rest.push(basename(cur));
    cur = parent;
  }
}

/** Whether the real path `real` lies strictly under the real directory `dir`. */
export function isUnder(real: string, dir: string): boolean {
  return real.startsWith(dir.endsWith(sep) ? dir : dir + sep);
}
