import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { realpathOrResolve } from '../lib/host.js';
import { fail, printInstanceTable, printJson } from './_shared/output.js';

export function registerLs(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('ls')
    .description('List brokered instances')
    .option('--host <dir>', 'filter instances by host repo root')
    .option('--json', 'print JSON')
    .action(async (o: { host?: string; json?: boolean }) => {
      try {
        const instances = await (await connect()).list(
          o.host ? { host: realpathOrResolve(o.host) } : undefined,
        );
        if (o.json) printJson(instances);
        else printInstanceTable(instances);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
