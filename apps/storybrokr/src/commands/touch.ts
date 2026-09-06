import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail } from './_shared/output.js';

export function registerTouch(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('touch <id-or-path>')
    .description("Reset an instance's idle timer")
    .action(async (idOrPath: string) => {
      try {
        const r = await (await connect()).touch(idOrPath);
        console.log(`${r.id} touched at ${r.lastTouchedAt}`);
      } catch (err) {
        fail(err, false);
      }
    });
}
