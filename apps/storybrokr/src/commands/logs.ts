import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail } from './_shared/output.js';

export function registerLogs(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('logs <id-or-path>')
    .description("Show an instance's Storybook output")
    .option('--tail <n>', 'lines to show', (v) => Number(v), 200)
    .option('--follow', 'keep streaming new lines')
    .action(async (idOrPath: string, o: { tail: number; follow?: boolean }) => {
      try {
        const client = await connect();
        const record = await client.get(idOrPath);
        for (const line of await client.logs(record.id, o.tail)) console.log(line);
        if (o.follow) {
          const stop = await client.follow(record.id, (line) => console.log(line));
          process.on('SIGINT', () => {
            stop();
            process.exit(0);
          });
          await new Promise(() => {});
        }
      } catch (err) {
        fail(err, false);
      }
    });
}
