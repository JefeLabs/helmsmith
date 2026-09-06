import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, parseIntegerInRange } from './_shared/output.js';

export function registerLogs(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('logs <id-or-path>')
    .description("Show an instance's Storybook output")
    .option('--tail <n>', 'lines to show', parseIntegerInRange(1, 2000), 200)
    .option('--follow', 'keep streaming new lines')
    .action(async (idOrPath: string, o: { tail: number; follow?: boolean }) => {
      try {
        const client = await connect();
        const record = await client.get(idOrPath);
        for (const line of await client.logs(record.id, o.tail)) console.log(line);
        if (o.follow) {
          await new Promise<void>((resolve) => {
            client
              .follow(record.id, (line) => console.log(line), resolve)
              .then((stop) => {
                process.once('SIGINT', () => {
                  stop();
                  process.exit(0);
                });
              });
          });
        }
      } catch (err) {
        fail(err, false);
      }
    });
}
