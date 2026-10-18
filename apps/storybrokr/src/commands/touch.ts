import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, resolveTarget } from './_shared/output.js';

export function registerTouch(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('touch <id-or-path>')
    .description("Reset an instance's idle timer")
    .option('--host <dir>', 'host repo root')
    .action(async (idOrPath: string, o: { host?: string }) => {
      try {
        const target = resolveTarget(idOrPath, o.host);
        const r = await (await connect()).touch(target.idOrPath, {
          host: target.host,
          hint: target.hint,
        });
        console.log(`${r.id} touched at ${r.lastTouchedAt}`);
      } catch (err) {
        fail(err, false);
      }
    });
}
