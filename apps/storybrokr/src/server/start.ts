import { homeDir } from '../lib/paths.js';
import { storybookSpawner } from '../lib/spawn.js';
import { Broker } from './broker.js';
import { loadConfig } from './config.js';
import { createDaemon } from './daemon.js';
import { Registry } from './registry.js';

const home = homeDir();
const config = loadConfig(home);
const registry = new Registry({ home, config });
const broker = new Broker({ registry, spawner: storybookSpawner, config });
await broker.reconcile();
const daemon = createDaemon({ home, broker, config });
const info = await daemon.start(
  process.env.STORYBROKR_PORT ? Number(process.env.STORYBROKR_PORT) : 0,
);
console.log(`storybrokr daemon listening on http://127.0.0.1:${info.port} (pid ${info.pid})`);
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void daemon.stop().finally(() => process.exit(0));
  });
}
