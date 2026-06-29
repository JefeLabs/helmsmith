/**
 * discord-timetracker CLI — thin commander wiring via @jefelabs/cli-kit.
 *
 * Each verb's logic lives in `src/commands/<verb>.ts`, matching the
 * pritty/gitradar layout so verb logic sits in a predictable place
 * across the monorepo. For M0 the handlers are stubs that report
 * "not implemented yet" — the command surface (and its flags) is the
 * deliverable here; behaviour lands in M1–M8 (see .plan/05-build-sequence.md).
 */
import { createCli, noopAuthProvider } from '@jefelabs/cli-kit';
import { runBackfill } from './commands/backfill.js';
import { runLink } from './commands/link.js';
import { runReport } from './commands/report.js';
import { runSetup } from './commands/setup.js';
import { runStart } from './commands/start.js';
import { runView } from './commands/view.js';

const { program } = createCli({
  name: 'discord-timetracker',
  version: '0.1.0',
  description: 'Admin-only Discord activity time tracker',
  // Local v1 runs without auth; swap for @jefelabs/agent-auth when hosted (see Q8).
  auth: noopAuthProvider,
});

program
  .command('setup')
  .description('Interactive first-run config (token, guild, channels, storage)')
  .action(() => runSetup());

program
  .command('start')
  .description('Run the bot: connect to the gateway and begin tracking')
  .action(() => runStart());

program
  .command('view')
  .description('Open the daily/weekly summary TUI')
  .option('-p, --period <period>', 'daily | weekly', 'daily')
  .option('-d, --date <iso>', 'anchor date (YYYY-MM-DD); defaults to today')
  .action((opts) => runView(opts));

program
  .command('report')
  .description('Print a daily/weekly summary (non-interactive)')
  .option('-p, --period <period>', 'daily | weekly', 'daily')
  .option('-d, --date <iso>', 'anchor date (YYYY-MM-DD); defaults to today')
  .option('--json', 'machine-readable JSON output')
  .option('--post', 'post the summary to the Discord report channel instead of printing')
  .action((opts) => runReport(opts));

program
  .command('backfill')
  .description('Replay channel history to recover message-driven activity (e.g. a late start)')
  .option('-s, --since <iso>', 'earliest local day to include (YYYY-MM-DD); defaults to today')
  .option('-n, --days <count>', 'alternative to --since: include the last N days (today inclusive)')
  .option('--dry-run', 'report what would be replayed without writing')
  .action((opts) => runBackfill(opts));

program
  .command('link')
  .description('Map a Discord user to a GitHub/CI identity (for CI attribution)')
  .action(() => runLink());

program.parse();
