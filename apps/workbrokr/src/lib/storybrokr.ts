import { spawnSync } from 'node:child_process';
import { WorkkitError } from '../core/index.js';

export interface StorybrokrInstance {
  id: string;
  port: number;
  url: string;
}

/** The frontend runner: the installed `storybrokr` CLI, which owns its daemon, ports and instances. */
export interface StorybrokrClient {
  up(story: string, hostRoot: string): Promise<StorybrokrInstance>;
  down(id: string): Promise<void>;
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

export const storybrokrCli: StorybrokrClient = {
  async up(story, hostRoot) {
    const r = run(['up', story, '--host', hostRoot, '--json']);
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
};
