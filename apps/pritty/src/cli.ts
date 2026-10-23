/**
 * Pritty CLI. Thin commander wiring — each verb's logic lives in
 * `src/commands/<verb>.ts`. Helpers used across multiple commands
 * (resolveTicketContext, splitTitleBody, renderRebaseTodo,
 * colorAction, the .claude / Copilot templates) live in
 * `src/commands/_shared/`.
 *
 * Pattern matches gitradar's src/commands/* — anyone navigating the
 * monorepo finds verb logic in a predictable place across every
 * app.
 */
import { createCli } from '@helmsmith/cli-kit';
import chalk from 'chalk';
import { prittyAuthProvider } from './auth-provider.js';
import { runAuthLogin } from './commands/auth-login.js';
import { runAuthLogout } from './commands/auth-logout.js';
import { runAuthStatus } from './commands/auth-status.js';
import { runCacheClear } from './commands/cache-clear.js';
import { runCachePath } from './commands/cache-path.js';
import { runCategorize } from './commands/categorize.js';
import { runCommit } from './commands/commit.js';
import { runInit } from './commands/init.js';
import { runPr } from './commands/pr.js';
import { runRebase } from './commands/rebase.js';
import { VERSION } from './version.js';

// Only destructure `program` — `auth` is already used below as the
// commander subcommand variable for `pritty auth ...`. The injected
// AuthProvider is reachable via cli-kit if a future handler needs it.
const { program } = createCli({
  name: 'pritty',
  version: VERSION,
  description: 'Pretty PRs, zero effort.',
  auth: prittyAuthProvider,
});

// ─── auth ─────────────────────────────────────────────────────────────

const authCmd = program.command('auth').description('Manage GitHub Copilot authentication');

authCmd
  .command('login')
  .description('Run the GitHub Device Flow and persist credentials')
  .action(() => runAuthLogin());

authCmd
  .command('logout')
  .description('Remove the local auth file')
  .action(() => runAuthLogout());

authCmd
  .command('status')
  .description('Show authentication status')
  .action(() => runAuthStatus());

// ─── init ─────────────────────────────────────────────────────────────

program
  .command('init')
  .description(
    'Write a starter .pritty.json + Claude Code / VS Code Copilot slash commands. Skips integration files outside a git repo.',
  )
  .option('--force', 'Overwrite existing files')
  .option('--no-claude', 'Skip writing .claude/commands/{commit,pr}.md')
  .option('--no-copilot', 'Skip writing .github/prompts/{commit,pr}.prompt.md')
  .option('--no-aliases', 'Skip the shell-alias prompt for `commit` / `pr`')
  .option('--no-skill', 'Skip writing .claude/skills/pritty/SKILL.md')
  .action(
    (options: {
      force?: boolean;
      claude?: boolean;
      copilot?: boolean;
      aliases?: boolean;
      skill?: boolean;
    }) => runInit(options),
  );

// ─── categorize ───────────────────────────────────────────────────────

program
  .command('categorize')
  .description('Categorize staged files (read-only — does not commit)')
  .option('--all', 'Include unstaged + untracked files too')
  .action((options: { all?: boolean }) => runCategorize(options));

// ─── cache ────────────────────────────────────────────────────────────

const cache = program
  .command('cache')
  .description('Manage the validated-ticket cache (~/.pritty/cache.json)');

cache
  .command('clear')
  .description('Wipe the validated-ticket cache')
  .action(() => runCacheClear());

cache
  .command('path')
  .description('Print the cache file path (useful for inspection / scripting)')
  .action(() => runCachePath());

// ─── commit / pr / rebase ─────────────────────────────────────────────

program
  .command('commit')
  .description('Generate AI commit messages per category and commit each group')
  .option('--auto-approve', 'Skip the confirmation prompt before committing')
  .option('--dry-run', 'Show the plan without making any commits')
  .option('--commit-style <style>', 'conventional | gitmoji | angular | simple')
  .option(
    '--json',
    'Print one JSON line { dryRun, commits: [{ category, message, files, sha }] } on stdout; implies --auto-approve',
  )
  .action(
    async (options: {
      autoApprove?: boolean;
      dryRun?: boolean;
      commitStyle?: string;
      json?: boolean;
    }) => {
      await runCommit(options);
    },
  );

program
  .command('pr')
  .description('Generate a pull request title + body via AI and open it on GitHub')
  .option('--base <branch>', "Base branch (default: repo's default branch)")
  .option('--auto-approve', 'Skip the confirmation prompt before pushing/creating')
  .option('--dry-run', 'Show the plan without pushing or creating the PR')
  .option(
    '--json',
    'Print one JSON line { number, url, created, draft, head, base } on stdout; implies --auto-approve; needs --base or a configured baseBranch',
  )
  .option('--draft', 'Open the PR as a draft')
  .option('--title <title>', 'Use this title verbatim (no AI, no ticket flow)')
  .option('--body <text>', 'Use this body verbatim (with --title)')
  .option('--body-file <path>', 'Read the body from a file (with --title)')
  .option('--no-push', 'Do not push: the branch is already on origin')
  .option(
    '--check',
    'Only print the open PR for this head and base as one JSON line { open }; push, generate and create nothing',
  )
  .action(
    async (options: {
      base?: string;
      autoApprove?: boolean;
      dryRun?: boolean;
      json?: boolean;
      draft?: boolean;
      title?: string;
      body?: string;
      bodyFile?: string;
      check?: boolean;
      push: boolean;
    }) => {
      const { push, ...rest } = options;
      await runPr({ ...rest, noPush: push === false });
    },
  );

program
  .command('rebase')
  .description('AI-planned interactive rebase over commits ahead of base branch')
  .option(
    '--strategy <strategy>',
    'interactive | squash | fixup | auto (default: interactive, or config.rebaseStrategy)',
  )
  .option('--base <branch>', 'Base ref to rebase onto (default: config.baseBranch or main)')
  .option('--dry-run', 'Show the plan; do NOT touch git')
  .action((options: { strategy?: string; base?: string; dryRun?: boolean }) => runRebase(options));

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
