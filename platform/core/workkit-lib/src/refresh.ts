import { spawnSync } from 'node:child_process';
import picomatch from 'picomatch';
import { WorkkitError } from './errors.js';
import type { RefreshEntry } from './types.js';

/** Which refresh commands and marks a sync's changed paths call for, in manifest order. */
export function selectRefresh(
  entries: RefreshEntry[],
  changedPaths: string[],
): { runs: string[]; marks: string[] } {
  const runs: string[] = [];
  const marks: string[] = [];
  for (const e of entries) {
    const hit =
      e.always === true ||
      (e.when !== undefined && changedPaths.some(picomatch(e.when, { dot: true })));
    if (!hit) continue;
    if (e.run) runs.push(e.run);
    if (e.mark) marks.push(e.mark);
  }
  return { runs, marks };
}

/** Run each command through `sh -c` in the worktree; the first failure names its command. */
export function runRefresh(
  runs: string[],
  cwd: string,
  log: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const cmd of runs) {
    log(`$ ${cmd}`);
    const r = spawnSync('sh', ['-c', cmd], { cwd, env, encoding: 'utf8' });
    if (r.stdout) log(r.stdout.trimEnd());
    if (r.stderr) log(r.stderr.trimEnd());
    if (r.status !== 0) {
      throw new WorkkitError('INTERNAL', `refresh command failed (${r.status}): ${cmd}`, {
        cmd,
        status: r.status,
      });
    }
  }
}
