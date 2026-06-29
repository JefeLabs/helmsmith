/**
 * ToolZ CLI entry. Thin commander wiring — each verb's logic lives
 * in `src/commands/<verb>.ts`. Matches gitradar's per-verb-file
 * pattern across the agentx-toolbox monorepo.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '@jefelabs/cli-kit';
import { runCheck } from './commands/check.js';
import { runConnect } from './commands/connect.js';
import { runDeregister } from './commands/deregister.js';
import { runDoctorCommand } from './commands/doctor.js';
import { runEnsure } from './commands/ensure.js';
import { runInstall } from './commands/install.js';
import { runList } from './commands/list.js';
import { runPlatform } from './commands/platform.js';
import { runRegister } from './commands/register.js';
import { runUninstall } from './commands/uninstall.js';
import { printBanner } from './ui/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersion(): string {
  // Walk up from the compiled cli.js (in dist/) to find package.json.
  for (let dir = __dirname, i = 0; i < 4; i++, dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === '@jefelabs/toolz') return pkg.version as string;
    } catch {
      /* keep walking */
    }
  }
  return '0.0.0';
}

// No `auth` wired today — toolz's current commands (check, install,
// ensure, register, etc.) don't make agent calls. When the planned
// "add new tools via agent" feature lands, wire a toolzAuthProvider
// here against @jefelabs/agent-auth — same pattern as pritty.
const { program } = createCli({
  name: 'toolz',
  version: readVersion(),
  description: 'ToolZ — cross-platform tool manager for AgentX',
});

program
  .command('platform')
  .description('Show the detected OS, architecture, distro family, and WSL state')
  .action(() => runPlatform());

program
  .command('check <tool>')
  .description('Check whether a CLI tool is installed; show its path and parsed version')
  .option('--version-flag <flag>', 'Override the default `--version` flag')
  .action((tool: string, options: { versionFlag?: string }) => runCheck(tool, options));

program
  .command('install <tool>')
  .description("Install a tool via the platform's package manager")
  .option('--via <manager>', 'Force a specific package manager (brew, apt, winget)')
  .option('--dry-run', "Print the command that would run; don't execute")
  .action((tool: string, options: { via?: string; dryRun?: boolean }) => runInstall(tool, options));

program
  .command('uninstall <tool>')
  .description("Uninstall a tool via the platform's package manager")
  .option('--via <manager>', 'Force a specific package manager')
  .action((tool: string, options: { via?: string }) => runUninstall(tool, options));

program
  .command('list')
  .description('List tools registered in the local registry')
  .option('--catalog', 'List every tool in the built-in catalog instead')
  .action((options: { catalog?: boolean }) => runList(options));

program
  .command('register <tool>')
  .description('Register an already-installed tool in the local registry')
  .action((tool: string) => runRegister(tool));

program
  .command('deregister <tool>')
  .description('Remove a tool from the registry (does NOT uninstall)')
  .action((tool: string) => runDeregister(tool));

program
  .command('ensure <tools...>')
  .description('Ensure one or more tools are installed; install missing ones if --auto-install')
  .option('--min-version <version>', 'Minimum acceptable semver (single tool only)')
  .option(
    '--auto-install',
    'Install missing tools automatically (default: report and exit non-zero)',
  )
  .option('--silent', 'Suppress progress logs (errors still print)')
  .option('--via <manager>', 'Force a specific package manager')
  .action(
    (
      tools: string[],
      options: {
        minVersion?: string;
        autoInstall?: boolean;
        silent?: boolean;
        via?: string;
      },
    ) => runEnsure(tools, options),
  );

program
  .command('doctor')
  .description(
    'Validate the registry against reality — detects stale paths, version drift, removed packages',
  )
  .option('--errors-only', 'Show only error-severity findings')
  .option('--json', 'Emit findings as JSON for scripting')
  .action((options: { errorsOnly?: boolean; json?: boolean }) => runDoctorCommand(options));

program
  .command('connect')
  .description('Open the interactive connections view (TUI)')
  .action(() => runConnect());

// Bare invocation (no subcommand, no --help, no --version) → branded
// banner + command hints. Commander's default is silent; this gives
// users a friendlier landing.
if (process.argv.length <= 2) {
  printBanner(readVersion());
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
