import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, printInstance, printJson } from './_shared/output.js';

export function registerGet(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('get <id-or-path>')
    .description('Show one instance, including its story URLs')
    .option('--json', 'print JSON')
    .action(async (idOrPath: string, o: { json?: boolean }) => {
      try {
        const record = await (await connect()).get(idOrPath);
        if (o.json) printJson(record);
        else printInstance(record);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
