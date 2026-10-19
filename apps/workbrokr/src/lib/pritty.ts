import { spawnSync } from 'node:child_process';
import { WorkkitError } from '../core/index.js';
import { compareSemver } from './storybrokr.js';

export interface PrRecord {
  number: number;
  url: string;
  draft: boolean;
}

export interface PrittyPrOptions {
  cwd: string;
  base: string;
  draft?: boolean;
  title?: string;
  body?: string;
  bodyFile?: string;
}

/** The PR mechanics: the installed `pritty` CLI (0.1.1 or newer), spawned in the worktree. */
export interface PrittyClient {
  /** The installed pritty version, checked once. */
  version(): string;
  /** Open a PR for the current branch, or return (and, with given words, update) the open one. */
  pr(o: PrittyPrOptions): Promise<PrRecord & { created: boolean }>;
  /** The open PR for the current branch and base, or null; creates nothing. */
  check(o: { cwd: string; base: string }): Promise<PrRecord | null>;
}

export const MIN_PRITTY_VERSION = '0.1.1';

export function assertPrittyVersion(client: PrittyClient): void {
  const found = client.version();
  if (compareSemver(found, MIN_PRITTY_VERSION) < 0) {
    throw new WorkkitError(
      'PRITTY_FAILED',
      `pritty >= ${MIN_PRITTY_VERSION} required (found ${found || 'unknown'}); npm i -g @helmsmith/pritty`,
    );
  }
}

function run(args: string[], cwd?: string): { code: number; out: string; err: string } {
  const r = spawnSync('pritty', args, { cwd, encoding: 'utf8', env: process.env });
  if (r.error) {
    throw new WorkkitError(
      'PRITTY_FAILED',
      `pritty is not installed (npm i -g @helmsmith/pritty): ${r.error.message}`,
    );
  }
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** The last stdout line is the JSON pritty promises under --json / --check. */
function lastJsonLine<T>(out: string, what: string): T {
  const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
  try {
    return JSON.parse(line) as T;
  } catch {
    throw new WorkkitError('PRITTY_FAILED', `pritty ${what} printed no JSON: ${out.trim()}`);
  }
}

let versionFound: string | undefined;

export const prittyCli: PrittyClient = {
  version() {
    if (versionFound === undefined) {
      const r = run(['--version']);
      versionFound = r.code === 0 ? r.out.trim() : '';
    }
    return versionFound;
  },
  async pr(o) {
    const args = ['pr', '--base', o.base, '--no-push', '--auto-approve', '--json'];
    if (o.draft) args.push('--draft');
    if (o.title !== undefined) args.push('--title', o.title);
    if (o.body !== undefined) args.push('--body', o.body);
    if (o.bodyFile !== undefined) args.push('--body-file', o.bodyFile);
    const r = run(args, o.cwd);
    if (r.code !== 0) {
      throw new WorkkitError('PRITTY_FAILED', `pritty pr failed: ${(r.err || r.out).trim()}`, {
        stderr: r.err,
      });
    }
    const j = lastJsonLine<{ number: number; url: string; draft: boolean; created: boolean }>(
      r.out,
      'pr',
    );
    return { number: j.number, url: j.url, draft: Boolean(j.draft), created: Boolean(j.created) };
  },
  async check(o) {
    const r = run(['pr', '--check', '--base', o.base], o.cwd);
    if (r.code !== 0) {
      throw new WorkkitError(
        'PRITTY_FAILED',
        `pritty pr --check failed: ${(r.err || r.out).trim()}`,
        {
          stderr: r.err,
        },
      );
    }
    const j = lastJsonLine<{ open: { number: number; url: string; draft: boolean } | null }>(
      r.out,
      'pr --check',
    );
    return j.open ? { number: j.open.number, url: j.open.url, draft: Boolean(j.open.draft) } : null;
  },
};
