import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, printInstance, printJson, resolveTarget } from './_shared/output.js';

export function registerGet(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('get <id-or-path>')
    .description('Show one instance, including its story URLs')
    .option('--host <dir>', 'host repo root')
    .option('--json', 'print JSON')
    .action(async (idOrPath: string, o: { host?: string; json?: boolean }) => {
      try {
        const target = resolveTarget(idOrPath, o.host);
        const record = await (await connect()).get(target.idOrPath, {
          host: target.host,
          hint: target.hint,
        });
        if (o.json) printJson(record);
        else printInstance(record);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
