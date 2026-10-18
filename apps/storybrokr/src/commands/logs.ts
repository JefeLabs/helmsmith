import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { fail, parseIntegerInRange, resolveTarget } from './_shared/output.js';

/**
 * Awaits the stream's end. `client.follow(...)` is awaited before anything is detached, so a
 * rejection (e.g. the daemon becomes unavailable between `client.get()` and this call) propagates
 * straight to the caller instead of becoming an unhandled rejection in a detached `.then()` chain.
 */
export async function followLogs(
  client: Pick<DaemonClient, 'follow'>,
  id: string,
  onLine: (line: string) => void,
  onSignal: (stop: () => void) => void = (stop) => {
    process.once('SIGINT', () => {
      stop();
      process.exit(0);
    });
  },
): Promise<void> {
  let resolveEnd: () => void = () => {};
  const ended = new Promise<void>((resolve) => {
    resolveEnd = resolve;
  });
  const stop = await client.follow(id, onLine, () => resolveEnd());
  onSignal(stop);
  await ended;
}

export function registerLogs(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('logs <id-or-path>')
    .description("Show an instance's Storybook output")
    .option('--host <dir>', 'host repo root')
    .option('--tail <n>', 'lines to show', parseIntegerInRange(1, 2000), 200)
    .option('--follow', 'keep streaming new lines')
    .action(async (idOrPath: string, o: { host?: string; tail: number; follow?: boolean }) => {
      try {
        const client = await connect();
        const target = resolveTarget(idOrPath, o.host);
        const record = await client.get(target.idOrPath, {
          host: target.host,
          hint: target.hint,
        });
        for (const line of await client.logs(record.id, o.tail)) console.log(line);
        if (o.follow) {
          await followLogs(client, record.id, (line) => console.log(line));
        }
      } catch (err) {
        fail(err, false);
      }
    });
}
