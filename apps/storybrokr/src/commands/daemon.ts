import type { Command } from 'commander';
import { DaemonClient } from '../client/index.js';
import { StorybrokrError } from '../lib/errors.js';
import { homeDir } from '../lib/paths.js';
import { storybookSpawner } from '../lib/spawn.js';
import { Broker } from '../server/broker.js';
import { loadConfig } from '../server/config.js';
import { createDaemon } from '../server/daemon.js';
import { Registry } from '../server/registry.js';
import { fail, parseIntegerInRange } from './_shared/output.js';

export function registerDaemon(program: Command): void {
  const cmd = program.command('daemon').description('Manage the broker daemon');
  cmd
    .command('start')
    .description('Run the daemon in the foreground')
    .option(
      '--port <n>',
      'listen port (default: ephemeral, recorded in daemon.json)',
      parseIntegerInRange(0, 65535),
      0,
    )
    .action(async (o: { port: number }) => {
      try {
        const home = homeDir();
        const config = loadConfig(home);
        const registry = new Registry({ home, config });
        const broker = new Broker({ registry, spawner: storybookSpawner, config });
        await broker.reconcile();
        const daemon = createDaemon({ home, broker, config });
        const info = await daemon.start(o.port);
        console.log(
          `storybrokr daemon listening on http://127.0.0.1:${info.port} (pid ${info.pid}, home ${home})`,
        );
        for (const sig of ['SIGTERM', 'SIGINT'] as const)
          process.on(sig, () => void daemon.stop().finally(() => process.exit(0)));
        await new Promise(() => {});
      } catch (err) {
        fail(err, false);
      }
    });
  cmd
    .command('stop')
    .description('Stop the daemon and every instance')
    .action(async () => {
      try {
        await (await DaemonClient.connect({ autoStart: false })).shutdown();
        console.log('daemon stopping');
      } catch (err) {
        fail(err, false);
      }
    });
  cmd
    .command('status')
    .description('Show daemon health')
    .action(async () => {
      try {
        const client = await DaemonClient.connect({ autoStart: false });
        const h = await client.health();
        console.log(
          `running  ${client.url}  pid ${h.pid}  up ${Math.round(h.uptimeMs / 1000)}s  instances ${h.instances}`,
        );
      } catch (err) {
        if (err instanceof StorybrokrError && err.code === 'DAEMON_UNAVAILABLE') {
          console.log('not running');
        } else {
          fail(err, false);
        }
      }
    });
}
