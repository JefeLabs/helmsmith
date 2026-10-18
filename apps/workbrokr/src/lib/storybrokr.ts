import { spawnSync } from 'node:child_process';
import { WorkkitError } from '../core/index.js';

export interface StorybrokrInstance {
  id: string;
  port: number;
  url: string;
}

/** The frontend runner: the installed `storybrokr` CLI, which owns its daemon, ports and instances. */
export interface StorybrokrClient {
  up(
    story: string,
    hostRoot: string,
    opts?: { ttlMinutes?: number; includeChildren?: boolean },
  ): Promise<StorybrokrInstance>;
  down(id: string): Promise<void>;
  /** Stop every instance whose host is `hostRoot`; returns their ids. Never starts a daemon. */
  downHost?(hostRoot: string): Promise<string[]>;
  touch?(id: string): Promise<void>;
  /** The installed storybrokr version, once checked. */
  version?(): string;
}

const MIN_STORYBROKR_VERSION = '0.3.0';
let versionChecked = false;
let versionFound = '';

export function compareSemver(a: string, b: string): number {
  const pa = a
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function run(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync('storybrokr', args, { encoding: 'utf8' });
  if (r.error) {
    throw new WorkkitError(
      'STORYBROKR_FAILED',
      `storybrokr is not installed (npm i -g @helmsmith/storybrokr): ${r.error.message}`,
    );
  }
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function assertStorybrokrVersion(): void {
  if (versionChecked) return;
  const r = run(['--version']);
  const found = r.out.trim();
  if (r.code !== 0 || compareSemver(found, MIN_STORYBROKR_VERSION) < 0) {
    throw new WorkkitError(
      'STORYBROKR_FAILED',
      `storybrokr >= ${MIN_STORYBROKR_VERSION} required (found ${found || 'unknown'}); upgrade @helmsmith/storybrokr`,
    );
  }
  versionChecked = true;
  versionFound = found;
}

export const storybrokrCli: StorybrokrClient = {
  async up(story, hostRoot, opts) {
    assertStorybrokrVersion();
    const args = ['up', story, '--host', hostRoot, '--json'];
    if (opts?.ttlMinutes !== undefined) args.push('--ttl', String(opts.ttlMinutes));
    if (opts?.includeChildren) args.push('--include-children');
    const r = run(args);
    if (r.code !== 0) {
      throw new WorkkitError(
        'STORYBROKR_FAILED',
        `storybrokr up ${story} failed: ${r.err.trim() || r.out.trim()}`,
      );
    }
    const record = JSON.parse(r.out) as { id: string; port: number; url: string };
    return { id: record.id, port: record.port, url: record.url };
  },
  async down(id) {
    const r = run(['down', id]);
    if (r.code !== 0)
      throw new WorkkitError('STORYBROKR_FAILED', `storybrokr down ${id} failed: ${r.err.trim()}`);
  },
  async downHost(hostRoot) {
    // --if-running: never start a daemon just to find nothing to stop
    const r = spawnSync('storybrokr', ['down', '--host', hostRoot, '--if-running', '--json'], {
      encoding: 'utf8',
    });
    if (r.error) return []; // storybrokr not installed: nothing can be running
    if (r.status !== 0) {
      throw new WorkkitError(
        'STORYBROKR_FAILED',
        `storybrokr down --host ${hostRoot} failed: ${(r.stderr || r.stdout || '').trim()}`,
      );
    }
    try {
      const parsed = JSON.parse(r.stdout) as { stopped?: string[] };
      return parsed.stopped ?? [];
    } catch {
      return [];
    }
  },
  version() {
    assertStorybrokrVersion();
    return versionFound;
  },
  async touch(id) {
    // Best-effort touch; ignore errors if the instance was already stopped.
    const r = spawnSync('storybrokr', ['touch', id], { encoding: 'utf8' });
    void r;
  },
};
