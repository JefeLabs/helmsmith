import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import type { InstanceRecord } from '../types.js';
import { fail } from './_shared/output.js';

/** Pure target selection: --all always succeeds (even with zero instances); otherwise an
 * id/path is required. */
export function selectDownTargets(
  list: InstanceRecord[],
  idOrPath: string | undefined,
  all: boolean,
): string[] {
  if (all) return list.map((r) => r.id);
  if (idOrPath) return [idOrPath];
  throw new Error('give an instance id/path or --all');
}

export function registerDown(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('down [id-or-path]')
    .description('Stop an instance and remove its config dir')
    .option('--all', 'stop every instance')
    .action(async (idOrPath: string | undefined, o: { all?: boolean }) => {
      try {
        const client = await connect();
        const list = o.all ? await client.list() : [];
        const targets = selectDownTargets(list, idOrPath, Boolean(o.all));
        for (const t of targets) await client.down(t);
        console.log(`stopped ${targets.length} instance${targets.length === 1 ? '' : 's'}`);
      } catch (err) {
        fail(err, false);
      }
    });
}
