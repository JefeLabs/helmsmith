import { createCli } from '@helmsmith/cli-kit';
import { registerEnv } from './commands/env.js';
import { registerInit } from './commands/init.js';
import { registerStart } from './commands/start.js';
import { registerStatus } from './commands/status.js';
import { VERSION } from './version.js';

const { program } = createCli({
  name: 'work',
  version: VERSION,
  description: 'Area-based work: start, status, finish, reap, retire, audit.',
});

registerInit(program);
registerStart(program);
registerStatus(program);
registerEnv(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
