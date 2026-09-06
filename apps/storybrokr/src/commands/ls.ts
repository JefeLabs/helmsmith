import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, printInstanceTable, printJson } from './_shared/output.js';

export function registerLs(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('ls')
    .description('List brokered instances')
    .option('--json', 'print JSON')
    .action(async (o: { json?: boolean }) => {
      try {
        const instances = await (await connect()).list();
        if (o.json) printJson(instances);
        else printInstanceTable(instances);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
