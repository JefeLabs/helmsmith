import type { Command } from 'commander';
import { DaemonClient } from '../client/index.js';
import { StorybrokrError } from '../lib/errors.js';
import { realpathOrResolve } from '../lib/host.js';
import type { InstanceRecord } from '../types.js';
import { fail, printJson, resolveTarget } from './_shared/output.js';

/** Pure target selection: --all always succeeds (even with zero instances); otherwise an
 * id/path is required. */
export function selectDownTargets(
  list: InstanceRecord[],
  idOrPath: string | undefined,
  all: boolean,
): string[] {
  if (all) return list.map((r) => r.id);
  if (idOrPath) return [idOrPath];
  throw new Error('give an instance id/path, --host <dir>, or --all');
}

export async function runDown(
  client: DaemonClient,
  idOrPath: string | undefined,
  opts: { all?: boolean; host?: string },
): Promise<string[]> {
  if (opts.all) {
    // --all scoped by --host means "everything in that host", never everything on the machine
    if (opts.host) return client.downByHost(realpathOrResolve(opts.host));
    const list = await client.list();
    const targets = selectDownTargets(list, undefined, true);
    for (const t of targets) await client.down(t);
    return targets;
  }
  if (!idOrPath && opts.host) {
    return client.downByHost(realpathOrResolve(opts.host));
  }
  const [rawTarget] = selectDownTargets([], idOrPath, false);
  const target = resolveTarget(rawTarget, opts.host);
  // Destructive: STORYBROKR_HOST is the host, never a hint that falls through to another worktree.
  await client.down(target.idOrPath, { host: target.host ?? target.hint, hint: undefined });
  return [target.idOrPath];
}

/** `down --if-running`: when no daemon is listening there is nothing to stop; never start one to find that out. */
export async function downIfRunning(
  connectNoStart: () => Promise<DaemonClient>,
  idOrPath: string | undefined,
  opts: { all?: boolean; host?: string },
): Promise<string[]> {
  let client: DaemonClient;
  try {
    client = await connectNoStart();
  } catch (err) {
    if (err instanceof StorybrokrError && err.code === 'DAEMON_UNAVAILABLE') return [];
    throw err;
  }
  return runDown(client, idOrPath, opts);
}

export function registerDown(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('down [id-or-path]')
    .description('Stop an instance (or all instances for --host) and remove its config dir')
    .option(
      '--host <dir>',
      'host repo root (or stop all instances in <dir> when id-or-path is omitted)',
    )
    .option('--all', 'stop every instance (every instance in <dir> when combined with --host)')
    .option('--if-running', 'do nothing (and start no daemon) when no daemon is listening')
    .option('--json', 'print JSON')
    .action(
      async (
        idOrPath: string | undefined,
        o: { host?: string; all?: boolean; ifRunning?: boolean; json?: boolean },
      ) => {
        try {
          const stopped = o.ifRunning
            ? await downIfRunning(() => DaemonClient.connect({ autoStart: false }), idOrPath, o)
            : await runDown(await connect(), idOrPath, o);
          if (o.json) printJson({ stopped });
          else console.log(`stopped ${stopped.length} instance${stopped.length === 1 ? '' : 's'}`);
        } catch (err) {
          fail(err, Boolean(o.json));
        }
      },
    );
}
