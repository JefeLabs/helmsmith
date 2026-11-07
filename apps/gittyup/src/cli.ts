import { createCli } from '@helmsmith/cli-kit';
import chalk from 'chalk';
import { CommanderError } from 'commander';
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
import { GittyupError } from './core/errors.js';
import { enterJsonMode, failJson, wantsJson } from './output/json.js';
import { VERSION } from './version.js';

// ─── JSON mode (spec §3) ───────────────────────────────────────────
// Decided from argv before commander parses, so usage errors are caught too.
const json = wantsJson(process.argv.slice(2));
if (json) enterJsonMode();

// No `auth` wired — gittyup's `src/auth/` handles its own GitHub
// OAuth/PAT flow inside the auth subcommand. cli-kit's AuthProvider
// abstraction is for apps with a single global token; gittyup's auth
// model is per-command.
const { program } = createCli({
  name: APP_NAME,
  version: VERSION,
  description: 'Multi-repo orchestration CLI with interactive conflict resolution',
});

if (json) {
  // Before any registerX(): commander copies these settings onto subcommands
  // when `.command()` runs, so setting them later would miss every subcommand.
  program.exitOverride();
  program.configureOutput({ outputError: () => {} });
}

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
  if (json) return;
  const { manifestPath, location } = resolveManifestPath();
  console.log(chalk.dim(`  config: ${manifestPath} [${location}]`));
});

// ─── Parse and execute ─────────────────────────────────────────────
if (!json) {
  program.parse();
} else {
  try {
    await program.parseAsync();
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) process.exit(0); // --help / --version
      failJson(
        new GittyupError('USAGE', err.message.replace(/^error: /, ''), { commander: err.code }),
      );
    }
    failJson(err);
  }
}
