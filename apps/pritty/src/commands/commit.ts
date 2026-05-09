import chalk from "chalk";
import { confirm, editor } from "@inquirer/prompts";
import ora from "ora";
import {
  generateCommitMessages,
  type CommitMessage,
} from "../ai.js";
import {
  categorize,
  mergeCategories,
  UNKNOWN_CATEGORY,
} from "../categorizer.js";
import { loadConfig } from "../config.js";
import { createGit } from "../git.js";
import { resolveTicketContext } from "./_shared/ticket-context.js";
import { splitTitleBody } from "./_shared/format.js";

export interface CommitOptions {
  autoApprove?: boolean;
  dryRun?: boolean;
  commitStyle?: string;
}

/**
 * Generate AI commit messages per category and commit each group via
 * path-restricted commits. Resolves ticket context up front so
 * validation gates fail fast (before any AI call).
 */
export async function runCommit(options: CommitOptions = {}): Promise<void> {
  const config = loadConfig();
  // CLI flags override config
  if (options.commitStyle) {
    const valid = ["conventional", "gitmoji", "angular", "simple"];
    if (!valid.includes(options.commitStyle)) {
      console.error(
        chalk.red(
          `✗ Invalid --commit-style. Valid: ${valid.join(", ")}`,
        ),
      );
      process.exit(1);
    }
    config.commitStyle = options.commitStyle as typeof config.commitStyle;
  }

  const git = createGit();

  // Resolve ticket context up front — gate fires (and exits) before
  // any AI call when validate: true and branch lacks a ticket. Saves
  // an API roundtrip and gives instant feedback.
  const branch = await git.getCurrentBranch();
  const ticketCtx = await resolveTicketContext(config, branch, git);

  // 1. Find staged files
  const staged = await git.getStaged();
  if (staged.length === 0) {
    console.log(
      chalk.dim(
        "No staged files. Stage what you want to commit with `git add` first.",
      ),
    );
    return;
  }

  // 2. Categorize
  const categories = mergeCategories(config.categories);
  const grouped = categorize(staged, categories);
  const nonEmpty = Object.entries(grouped).filter(
    ([, files]) => files.length > 0,
  );

  console.log(chalk.cyan(`Staged files (${staged.length}) — by category:`));
  for (const [name, files] of nonEmpty) {
    const tag =
      name === UNKNOWN_CATEGORY ? chalk.yellow(name) : chalk.green(name);
    console.log(`  ${tag} ${chalk.dim(`(${files.length})`)}`);
    for (const f of files) console.log(`    ${chalk.dim(f)}`);
  }
  console.log("");

  // 3. Generate AI commit messages
  const spinner = ora({ text: "Generating commit messages...", color: "cyan" }).start();
  let plan: CommitMessage[];
  try {
    const diff = await git.getStagedDiff();
    plan = await generateCommitMessages(grouped, diff, config, ticketCtx);
    spinner.succeed(`Generated ${plan.length} commit message(s)`);
  } catch (err) {
    spinner.fail((err as Error).message);
    process.exit(1);
  }

  // 4. Show plan
  console.log("");
  console.log(chalk.cyan("Commit plan:"));
  for (const c of plan) {
    console.log(
      `  ${chalk.bold(c.category)}  ${chalk.dim(`(${c.files.length} files)`)}`,
    );
    console.log(`    ${chalk.green(c.message)}`);
    if (c.body) {
      for (const line of c.body.split("\n")) {
        console.log(`    ${chalk.dim(line)}`);
      }
    }
  }
  console.log("");

  // 4.5. Optional per-commit editing — default N so the wrap-up
  // stays fast. Skipped under --auto-approve and --dry-run.
  if (!options.autoApprove && !options.dryRun) {
    for (let i = 0; i < plan.length; i++) {
      const c = plan[i]!;
      const wantEdit = await confirm({
        message: `Edit message for ${c.category}?`,
        default: false,
      });
      if (!wantEdit) continue;
      const fullMessage = c.body ? `${c.message}\n\n${c.body}` : c.message;
      const edited = await editor({
        message: `Editing ${c.category} commit message`,
        default: fullMessage,
      });
      const { title: nextMessage, body: nextBody } = splitTitleBody(edited);
      if (nextMessage.length === 0) {
        console.log(chalk.yellow("⚠ Empty message — keeping original."));
        continue;
      }
      plan[i] = {
        ...c,
        message: nextMessage,
        body: nextBody.length > 0 ? nextBody : undefined,
      };
    }
  }

  // 5. Dry-run exits here
  if (options.dryRun) {
    console.log(
      chalk.yellow(
        "Dry-run — no commits made. Re-run without --dry-run to apply.",
      ),
    );
    return;
  }

  // 6. Confirm (skippable)
  if (!options.autoApprove) {
    const ok = await confirm({
      message: `Create ${plan.length} commit(s) above?`,
      default: true,
    });
    if (!ok) {
      console.log(chalk.dim("Aborted. No commits made."));
      return;
    }
  }

  // 7. Commit each group via path-restricted commit
  let committed = 0;
  for (const c of plan) {
    try {
      const fullMessage = c.body ? `${c.message}\n\n${c.body}` : c.message;
      await git.commit(fullMessage, c.files);
      committed++;
      console.log(chalk.green(`✓ committed ${c.category}: ${c.message}`));
    } catch (err) {
      console.error(
        chalk.red(
          `✗ failed to commit ${c.category}: ${(err as Error).message}`,
        ),
      );
      process.exit(1);
    }
  }

  console.log(chalk.green(`\n✓ ${committed} commit(s) created.`));
}
