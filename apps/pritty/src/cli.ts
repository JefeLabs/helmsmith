/**
 * Pritty CLI. Phase 1 surface: auth, init, categorize. Commit/pr/rebase/
 * hooks land in follow-up phases — wired here as stubs that print a
 * "coming soon" message so users learn the command exists.
 */

import { Command } from "commander";
import chalk from "chalk";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { simpleGit } from "simple-git";
import { getAuthPath, login as authLogin, logout as authLogout, readAuth } from "./auth.js";
import { defaultStarterConfig, loadConfig } from "./config.js";
import { categorize, mergeCategories } from "./categorizer.js";

const program = new Command();

program
  .name("pritty")
  .description("Pretty PRs, zero effort.")
  .version("0.0.1");

// ─── auth ─────────────────────────────────────────────────────────────

const auth = program
  .command("auth")
  .description("Manage GitHub Copilot authentication");

auth
  .command("login")
  .description("Run the GitHub Device Flow and persist credentials")
  .action(async () => {
    try {
      const result = await authLogin({
        onPrompt: ({ verificationUri, userCode }) => {
          console.log("");
          console.log(chalk.cyan("Open this URL in a browser:"));
          console.log(`  ${chalk.bold(verificationUri)}`);
          console.log("");
          console.log(chalk.cyan("Enter this code:"));
          console.log(`  ${chalk.bold.yellow(userCode)}`);
          console.log("");
          console.log(chalk.dim("Waiting for authorization..."));
        },
      });
      console.log(chalk.green(`✓ Logged in (provider: ${result.provider})`));
      console.log(chalk.dim(`  scope:  ${result.scope ?? "(default)"}`));
      console.log(chalk.dim(`  stored: ${getAuthPath()}`));
    } catch (err) {
      console.error(chalk.red(`✗ Login failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

auth
  .command("logout")
  .description("Remove the local auth file")
  .action(async () => {
    await authLogout();
    console.log(chalk.green(`✓ Logged out (removed ${getAuthPath()})`));
  });

auth
  .command("status")
  .description("Show authentication status")
  .action(async () => {
    const file = await readAuth();
    const providers = Object.entries(file.providers);
    if (providers.length === 0) {
      console.log(chalk.dim("Not logged in. Run `pritty auth login`."));
      return;
    }
    console.log(chalk.cyan(`Authenticated providers (${providers.length})`));
    for (const [id, entry] of providers) {
      console.log(`  ${chalk.bold(id)}`);
      console.log(chalk.dim(`    scope:    ${entry.scope ?? "(default)"}`));
      console.log(chalk.dim(`    created:  ${entry.createdAt ?? "?"}`));
      if (entry.expiresAt) console.log(chalk.dim(`    expires:  ${entry.expiresAt}`));
    }
  });

// ─── init ─────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Write a starter .pritty.json to the current directory")
  .option("--force", "Overwrite an existing .pritty.json")
  .action((options: { force?: boolean }) => {
    const path = join(process.cwd(), ".pritty.json");
    if (existsSync(path) && !options.force) {
      console.error(
        chalk.red(`✗ ${path} already exists. Pass --force to overwrite.`),
      );
      process.exit(1);
    }
    writeFileSync(path, JSON.stringify(defaultStarterConfig(), null, 2) + "\n");
    console.log(chalk.green(`✓ Wrote ${path}`));
  });

// ─── categorize ───────────────────────────────────────────────────────

program
  .command("categorize")
  .description("Categorize staged files (read-only — does not commit)")
  .option("--all", "Include unstaged + untracked files too")
  .action(async (options: { all?: boolean }) => {
    const config = loadConfig();
    const git = simpleGit(process.cwd());
    const status = await git.status();
    const files = options.all
      ? [...status.staged, ...status.modified, ...status.not_added]
      : [...status.staged];

    if (files.length === 0) {
      console.log(chalk.dim("No staged files. (Use --all to include modified/untracked.)"));
      return;
    }

    const categories = mergeCategories(config.categories);
    const grouped = categorize(files, categories);
    for (const [name, list] of Object.entries(grouped)) {
      if (list.length === 0) continue;
      console.log(chalk.cyan(`${name}  ${chalk.dim(`(${list.length})`)}`));
      for (const file of list) console.log(`  ${file}`);
    }
  });

// ─── stubs (commit, pr, rebase, hooks) ────────────────────────────────

const stubMessage = (cmdName: string) =>
  chalk.yellow(
    `⚠ \`pritty ${cmdName}\` is not implemented yet. Tracked in the implementation plan; ` +
      `the auth + categorize surface ships first so the foundation is testable.`,
  );

program
  .command("commit")
  .description("AI-generated commit messages per category (coming soon)")
  .action(() => {
    console.log(stubMessage("commit"));
    process.exit(2);
  });

program
  .command("pr")
  .description("AI-generated pull request title + body (coming soon)")
  .action(() => {
    console.log(stubMessage("pr"));
    process.exit(2);
  });

program
  .command("rebase")
  .description("AI-planned interactive rebase (coming soon)")
  .action(() => {
    console.log(stubMessage("rebase"));
    process.exit(2);
  });

program
  .command("hooks")
  .description("Interactive pre-commit / pre-push hook selection (coming soon)")
  .action(() => {
    console.log(stubMessage("hooks"));
    process.exit(2);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
