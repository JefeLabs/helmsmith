import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@x',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@x',
};

/** Run git in `cwd` with a fixed identity and no global config; returns stdout. */
export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...IDENTITY, GIT_CONFIG_GLOBAL: '/dev/null' },
  }).toString();
}

/** A fresh repository on `main` with one committed README; identity stored in its config. */
export function makeRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'pritty-repo-'));
  gitIn(dir, 'init', '-q', '-b', 'main');
  gitIn(dir, 'config', 'user.name', IDENTITY.GIT_AUTHOR_NAME);
  gitIn(dir, 'config', 'user.email', IDENTITY.GIT_AUTHOR_EMAIL);
  gitIn(dir, 'config', 'commit.gpgsign', 'false');
  commitFile(dir, 'README.md', 'hello\n', 'init');
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function write(repo: string, path: string, content: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

export function commitFile(repo: string, path: string, content: string, message: string): void {
  write(repo, path, content);
  gitIn(repo, 'add', path);
  gitIn(repo, 'commit', '-q', '-m', message);
}

export function headFile(repo: string, path: string): string | null {
  try {
    return gitIn(repo, 'show', `HEAD:${path}`);
  } catch {
    return null;
  }
}

export function stagedPaths(repo: string): string[] {
  return gitIn(repo, 'diff', '--cached', '--name-only')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}
