import { createCli } from '@helmsmith/cli-kit';
import { registerAudit } from './commands/audit.js';
import { registerEnv } from './commands/env.js';
import { registerFinish } from './commands/finish.js';
import { registerHook } from './commands/hook.js';
import { registerInit } from './commands/init.js';
import { registerMcp } from './commands/mcp.js';
import { registerPr } from './commands/pr.js';
import { registerPromote } from './commands/promote.js';
import { registerReap } from './commands/reap.js';
import { registerRetire } from './commands/retire.js';
import { registerStart } from './commands/start.js';
import { registerStatus } from './commands/status.js';
import { VERSION } from './version.js';

const { program } = createCli({
  name: 'work',
  version: VERSION,
  description: 'Area-based work: start, promote, status, pr, finish, reap, retire, audit.',
});

registerInit(program);
registerStart(program);
registerPromote(program);
registerStatus(program);
registerEnv(program);
registerPr(program);
registerFinish(program);
registerReap(program);
registerRetire(program);
registerAudit(program);
registerHook(program);
registerMcp(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
