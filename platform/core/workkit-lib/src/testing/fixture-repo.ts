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

export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, ...IDENTITY, GIT_CONFIG_GLOBAL: '/dev/null' },
  }).toString();
}

/** A bare origin plus a clone on `base` with one pushed commit. */
export function makeRepo(base = 'develop'): { origin: string; main: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'wk-repo-'));
  const origin = join(dir, 'origin.git');
  const main = join(dir, 'main');
  gitIn(dir, 'init', '-q', '--bare', '-b', base, origin);
  gitIn(dir, 'clone', '-q', origin, main);
  gitIn(main, 'checkout', '-q', '-B', base);
  commitFile(main, 'README.md', 'hello', 'init');
  gitIn(main, 'push', '-q', '-u', 'origin', base);
  return { origin, main, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function commitFile(repo: string, path: string, content: string, message: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
  gitIn(repo, 'add', path);
  gitIn(repo, 'commit', '-q', '-m', message);
}
