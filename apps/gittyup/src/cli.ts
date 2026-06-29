import { createCli } from '@helmsmith/cli-kit';
import chalk from 'chalk';
import {
  registerAuth,
  registerCache,
  registerCompare,
  registerConfig,
  registerConnect,
  registerFetch,
  registerFind,
  registerGroup,
  registerInit,
  registerMerge,
  registerPick,
  registerPrs,
  registerRebrand,
  registerRepo,
  registerStatus,
} from './commands/index.js';
import { APP_NAME } from './config/branding.js';
import { resolveManifestPath } from './config/manifest.js';

// No `auth` wired — gittyup's `src/auth/` handles its own GitHub
// OAuth/PAT flow inside the auth subcommand. cli-kit's AuthProvider
// abstraction is for apps with a single global token; gittyup's auth
// model is per-command.
const { program } = createCli({
  name: APP_NAME,
  version: '0.1.0',
  description: 'Multi-repo orchestration CLI with interactive conflict resolution',
});

// ─── Register commands ─────────────────────────────────────────────
registerInit(program);
registerRepo(program);
registerFind(program);
registerGroup(program);
registerStatus(program);
registerFetch(program);
registerCompare(program);
registerMerge(program);
registerPick(program);
registerPrs(program);
registerCache(program);
registerAuth(program);
registerConfig(program);
registerConnect(program);
registerRebrand(program);

// ─── Post-action: display config path ─────────────────────────────
program.hook('postAction', () => {
  const { manifestPath, location } = resolveManifestPath();
  console.log(chalk.dim(`  config: ${manifestPath} [${location}]`));
});

// ─── Parse and execute ─────────────────────────────────────────────
program.parse();
