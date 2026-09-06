import { createCli } from '@helmsmith/cli-kit';
import { DaemonClient } from './client/index.js';
import { registerDaemon } from './commands/daemon.js';
import { registerDoctor } from './commands/doctor.js';
import { registerDown } from './commands/down.js';
import { registerGet } from './commands/get.js';
import { registerLogs } from './commands/logs.js';
import { registerLs } from './commands/ls.js';
import { registerOpen } from './commands/open.js';
import { registerTouch } from './commands/touch.js';
import { registerUp } from './commands/up.js';
import { VERSION } from './version.js';

const { program } = createCli({
  name: 'storybrokr',
  version: VERSION,
  description: 'Broker ephemeral single-component Storybook instances from an existing Storybook.',
});

const connect = () => DaemonClient.connect();

registerUp(program, connect);
registerLs(program, connect);
registerGet(program, connect);
registerDown(program, connect);
registerOpen(program, connect);
registerLogs(program, connect);
registerTouch(program, connect);
registerDoctor(program);
registerDaemon(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
