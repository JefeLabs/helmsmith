import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export interface ConnectDeps {
  /** Absolute path of `pritty-connect` on PATH, or null. */
  which: (name: string) => string | null;
  /** Run it in the foreground and return its exit code. */
  spawn: (cmd: string, args: string[]) => number;
}

function whichOnPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // next
    }
  }
  return null;
}

const defaultDeps: ConnectDeps = {
  which: whichOnPath,
  spawn: (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' }).status ?? 1,
};

/**
 * `pritty connect` lives in `@helmsmith/pritty-connect`: its OpenTUI view needs Bun, and
 * keeping it out of this package lets everything else install and run under plain Node.
 */
export async function runConnect(args: string[], deps: ConnectDeps = defaultDeps): Promise<number> {
  const bin = deps.which('pritty-connect');
  if (!bin) {
    throw new Error(
      'The connections view ships separately. Install it with `npm i -g @helmsmith/pritty-connect`, then run `pritty connect` or `pritty-connect`.',
    );
  }
  return deps.spawn(bin, args);
}
