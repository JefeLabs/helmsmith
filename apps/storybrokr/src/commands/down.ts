import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail } from './_shared/output.js';

export function registerDown(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('down [id-or-path]')
    .description('Stop an instance and remove its config dir')
    .option('--all', 'stop every instance')
    .action(async (idOrPath: string | undefined, o: { all?: boolean }) => {
      try {
        const client = await connect();
        const targets = o.all ? (await client.list()).map((r) => r.id) : idOrPath ? [idOrPath] : [];
        if (targets.length === 0) throw new Error('give an instance id/path or --all');
        for (const t of targets) await client.down(t);
        console.log(`stopped ${targets.length} instance${targets.length === 1 ? '' : 's'}`);
      } catch (err) {
        fail(err, false);
      }
    });
}
