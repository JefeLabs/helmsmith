import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import picomatch from 'picomatch';
import { WorkkitError } from './errors.js';
import type { RefreshEntry } from './types.js';

function matchesWhen(glob: string): (p: string) => boolean {
  const isMatch = picomatch(glob, { dot: true });
  return (p) => isMatch(p);
}

function readStamps(stampFile?: string): Record<string, string> {
  if (!stampFile || !existsSync(stampFile)) return {};
  try {
    return JSON.parse(readFileSync(stampFile, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeStamps(stampFile: string, stamps: Record<string, string>): void {
  mkdirSync(dirname(stampFile), { recursive: true });
  writeFileSync(stampFile, `${JSON.stringify(stamps, null, 2)}\n`);
}

function matchedFilesInWorktree(worktree: string, whenGlob: string): string[] {
  if (!/[*?[{]/.test(whenGlob)) {
    return existsSync(join(worktree, whenGlob)) ? [whenGlob] : [];
  }
  const r = spawnSync('git', ['ls-files'], { cwd: worktree, encoding: 'utf8' });
  if (r.status !== 0) return [];
  const isMatch = matchesWhen(whenGlob);
  return (r.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && isMatch(l) && existsSync(join(worktree, l)));
}

function hashFiles(worktree: string, relPaths: string[]): string | null {
  if (relPaths.length === 0) return null;
  const h = createHash('sha256');
  for (const rel of [...relPaths].sort()) {
    const abs = join(worktree, rel);
    if (!existsSync(abs)) continue;
    h.update(`${rel}\0`);
    h.update(readFileSync(abs));
    h.update('\0');
  }
  return h.digest('hex');
}

function isFileCleanInGit(worktree: string, relPath: string): boolean {
  const r = spawnSync('git', ['status', '--porcelain', '--', relPath], {
    cwd: worktree,
    encoding: 'utf8',
  });
  return r.status === 0 && (r.stdout ?? '').trim().length === 0;
}

export interface SelectRefreshOptions {
  worktree?: string;
  stampFile?: string;
}

export interface SelectRefreshResult {
  runs: string[];
  marks: string[];
  pendingStamps?: Record<string, string>;
  cleanWhenFiles?: string[];
}

/** Which refresh commands and marks a sync's changed paths or unstamped `when` files call for, in manifest order. */
export function selectRefresh(
  entries: RefreshEntry[],
  changedPaths: string[],
  opts?: SelectRefreshOptions,
): SelectRefreshResult {
  const runs: string[] = [];
  const marks: string[] = [];
  const stored = readStamps(opts?.stampFile);
  const pendingStamps: Record<string, string> = { ...stored };
  const cleanWhenFiles = new Set<string>();

  for (const e of entries) {
    let hit = e.always === true;
    let matchedFiles: string[] = [];
    if (e.when !== undefined) {
      const byChanged = changedPaths.some(matchesWhen(e.when));
      if (opts?.worktree) {
        matchedFiles = matchedFilesInWorktree(opts.worktree, e.when);
        const digest = hashFiles(opts.worktree, matchedFiles);
        if (digest !== null) {
          if (stored[e.when] !== digest) hit = true;
          pendingStamps[e.when] = digest;
        }
      }
      if (byChanged) hit = true;
    }
    if (!hit) continue;
    if (e.run) {
      runs.push(e.run);
      if (opts?.worktree && e.when && e.restoreWhenIfClean !== false) {
        for (const f of matchedFiles) {
          if (isFileCleanInGit(opts.worktree, f)) cleanWhenFiles.add(f);
        }
      }
    }
    if (e.mark) marks.push(e.mark);
  }
  if (!opts?.worktree) return { runs, marks };
  return {
    runs,
    marks,
    pendingStamps,
    cleanWhenFiles: [...cleanWhenFiles],
  };
}

export interface RunRefreshOptions {
  stampFile?: string;
  pendingStamps?: Record<string, string>;
  restoreFiles?: string[];
}

/** Run each command through `sh -c` in the worktree; the first failure names its command. */
export function runRefresh(
  runs: string[],
  cwd: string,
  log: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  opts?: RunRefreshOptions,
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
  if (opts?.restoreFiles && opts.restoreFiles.length > 0) {
    for (const rel of opts.restoreFiles) {
      if (!isFileCleanInGit(cwd, rel)) {
        spawnSync('git', ['checkout', '--', rel], { cwd, encoding: 'utf8' });
      }
    }
  }
  if (opts?.stampFile && opts.pendingStamps) {
    writeStamps(opts.stampFile, opts.pendingStamps);
  }
}
