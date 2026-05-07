/**
 * Pritty CLI. Phase-2 surface: auth, init, categorize, commit.
 * pr/rebase/hooks land in follow-up phases — wired as CLI stubs so
 * users learn the surface exists.
 */

import { Command } from "commander";
import chalk from "chalk";
import { confirm, editor } from "@inquirer/prompts";
import ora from "ora";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  generateCommitMessages,
  generatePR,
  type CommitMessage,
  type TicketContext,
} from "./ai.js";
import { detectTicket, ticketLink } from "./ticket.js";
import {
  addLabels,
  createPR,
  getDefaultBranch,
  listOpenPRsForHead,
} from "./github.js";
import { parseGitHubRemote } from "./git.js";
import { getAuthPath, login as authLogin, logout as authLogout, readAuth } from "./auth.js";
import { defaultStarterConfig, loadConfig } from "./config.js";
import {
  categorize,
  mergeCategories,
  UNKNOWN_CATEGORY,
} from "./categorizer.js";
import { createGit } from "./git.js";

/**
 * Resolve the active ticket context from config + branch name. When
 * config.ticket is unset, returns undefined (no enrichment, no gate).
 * When set, detects the ticket from the branch; if `validate: true`
 * and no ticket found, exits 1 with a clear message — no interactive
 * prompt, no override flag.
 */
function resolveTicketContext(
  config: ReturnType<typeof loadConfig>,
  branch: string,
): TicketContext | undefined {
  if (!config.ticket) return undefined;
  const ticket = detectTicket(branch, config.ticket.pattern);
  if (config.ticket.validate && !ticket) {
    console.error(
      chalk.red(
        `✗ Branch "${branch}" has no ticket reference matching pattern ${config.ticket.pattern}.`,
      ),
    );
    console.error(
      chalk.dim(
        `  Rename your branch to include a ticket (e.g. feature/PROJ-123-foo)`,
      ),
    );
    console.error(
      chalk.dim(`  or set ticket.validate: false in .pritty.json.`),
    );
    process.exit(1);
  }
  return {
    ticket,
    link: ticketLink(ticket, config.ticket.linkTemplate),
  };
}

/**
 * Parse text from $EDITOR back into { subject/title, body }. Standard
 * conventional-commit / PR format: first line is the subject, blank
 * line(s), then body. Tolerant of users who skip the blank-line rule.
 */
function splitTitleBody(text: string): { title: string; body: string } {
  const lines = text.split("\n");
  const title = (lines[0] ?? "").trim();
  let i = 1;
  // Skip blank separators after the title
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const body = lines.slice(i).join("\n").trimEnd();
  return { title, body };
}

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
    const git = createGit();
    const files = options.all
      ? await git.getAllChanged()
      : await git.getStaged();

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
  .description("Generate AI commit messages per category and commit each group")
  .option("--auto-approve", "Skip the confirmation prompt before committing")
  .option("--dry-run", "Show the plan without making any commits")
  .option("--commit-style <style>", "conventional | gitmoji | angular | simple")
  .action(
    async (options: {
      autoApprove?: boolean;
      dryRun?: boolean;
      commitStyle?: string;
    }) => {
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

      // Resolve ticket context up front — gate fires (and exits)
      // before any AI call when validate: true and branch lacks a
      // ticket. Saves an API roundtrip and gives instant feedback.
      const branch = await git.getCurrentBranch();
      const ticketCtx = resolveTicketContext(config, branch);

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
      // stays fast. Skipped entirely under --auto-approve and --dry-run.
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
            console.log(
              chalk.yellow("⚠ Empty message — keeping original."),
            );
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
          chalk.yellow("Dry-run — no commits made. Re-run without --dry-run to apply."),
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

      // 7. Commit each group
      // We need to stage only the files for the current group between
      // commits. Simplest robust approach: reset all staged, then
      // re-stage per group. But that's destructive on user's index.
      // Safer: rely on the existing index for the first commit, then
      // for subsequent groups, stage their files explicitly. Since
      // every file in `plan[*].files` is already staged (came from
      // git.getStaged()), `git add` is idempotent.
      let committed = 0;
      for (const c of plan) {
        try {
          // Path-restricted commit (`git commit -- <files>`) — only
          // this group's files end up in this commit, even though all
          // groups' files are currently in the index. Avoids the
          // unstage-then-restage dance.
          const fullMessage = c.body ? `${c.message}\n\n${c.body}` : c.message;
          await git.commit(fullMessage, c.files);
          committed++;
          console.log(chalk.green(`✓ committed ${c.category}: ${c.message}`));
        } catch (err) {
          console.error(
            chalk.red(`✗ failed to commit ${c.category}: ${(err as Error).message}`),
          );
          process.exit(1);
        }
      }

      console.log(chalk.green(`\n✓ ${committed} commit(s) created.`));
    },
  );

program
  .command("pr")
  .description("Generate a pull request title + body via AI and open it on GitHub")
  .option("--base <branch>", "Base branch (default: repo's default branch)")
  .option("--auto-approve", "Skip the confirmation prompt before pushing/creating")
  .option("--dry-run", "Show the plan without pushing or creating the PR")
  .action(
    async (options: {
      base?: string;
      autoApprove?: boolean;
      dryRun?: boolean;
    }) => {
      const config = loadConfig();
      const git = createGit();

      // 1. Resolve branch + remote → owner/repo
      const branch = await git.getCurrentBranch();
      const ticketCtx = resolveTicketContext(config, branch);
      const remoteUrl = await git.getRemoteUrl();
      if (!remoteUrl) {
        console.error(
          chalk.red("✗ No `origin` remote configured. Add one with `git remote add origin ...`."),
        );
        process.exit(1);
      }
      const repo = parseGitHubRemote(remoteUrl);
      if (!repo) {
        console.error(
          chalk.red(`✗ Remote URL doesn't look like GitHub: ${remoteUrl}`),
        );
        process.exit(1);
      }

      const base = options.base ?? config.baseBranch;
      // If config.baseBranch is the schema default ("main") but the
      // repo's actual default branch differs, prefer the GitHub-side
      // default. Saves users from accidental wrong-base PRs.
      let effectiveBase = base;
      try {
        const defaultBranch = await getDefaultBranch(repo.owner, repo.repo);
        if (!options.base && defaultBranch !== base) {
          console.log(
            chalk.dim(
              `Note: repo's default branch is ${defaultBranch}, config's baseBranch is ${base}. Using ${defaultBranch}. Pass --base to override.`,
            ),
          );
          effectiveBase = defaultBranch;
        }
      } catch (err) {
        console.error(
          chalk.yellow(
            `⚠ Couldn't query repo default branch: ${(err as Error).message}`,
          ),
        );
      }

      console.log(
        chalk.cyan(
          `Repository: ${repo.owner}/${repo.repo}  ${chalk.dim(`(${branch} → ${effectiveBase})`)}`,
        ),
      );

      // 2. Warn about existing open PRs from this branch
      try {
        const open = await listOpenPRsForHead(repo.owner, repo.repo, branch);
        if (open.length > 0) {
          console.log(
            chalk.yellow(
              `⚠ ${open.length} open PR(s) already exist for ${branch}:`,
            ),
          );
          for (const pr of open) {
            console.log(`    ${chalk.dim(`#${pr.number}`)} ${pr.title} — ${pr.url}`);
          }
        }
      } catch (err) {
        console.error(
          chalk.yellow(
            `⚠ Couldn't list existing PRs: ${(err as Error).message}`,
          ),
        );
      }

      // 3. Get commits between base and HEAD
      const commits = await git.log(effectiveBase);
      if (commits.length === 0) {
        console.log(
          chalk.dim(
            `No commits between ${effectiveBase} and ${branch}. Nothing to PR.`,
          ),
        );
        return;
      }
      console.log(chalk.cyan(`Commits in PR (${commits.length}):`));
      for (const c of commits) {
        console.log(`  ${chalk.dim(c.hash.slice(0, 7))}  ${c.subject}`);
      }
      console.log("");

      // 4. AI-generate title + body + labels
      const spinner = ora({ text: "Generating PR description...", color: "cyan" }).start();
      let draft;
      try {
        draft = await generatePR(
          commits,
          { branch, base: effectiveBase, owner: repo.owner, repo: repo.repo },
          config,
          ticketCtx,
        );
        spinner.succeed("PR description ready");
      } catch (err) {
        spinner.fail((err as Error).message);
        process.exit(1);
      }

      // 5. Show preview
      console.log("");
      console.log(chalk.bold.cyan(draft.title));
      console.log("");
      for (const line of draft.body.split("\n")) {
        console.log(`  ${chalk.dim(line)}`);
      }
      if (draft.labels.length > 0) {
        console.log("");
        console.log(`  ${chalk.dim("Labels: ")}${draft.labels.join(", ")}`);
      }
      console.log("");

      // 5.5. Optional editor pass — default N so the wrap-up stays
      // fast. Skipped under --auto-approve / --dry-run.
      if (!options.autoApprove && !options.dryRun) {
        const wantEdit = await confirm({
          message: "Edit PR title or body?",
          default: false,
        });
        if (wantEdit) {
          const combined = `${draft.title}\n\n${draft.body}`;
          const edited = await editor({
            message: "Editing PR (first line = title, blank line, then body)",
            default: combined,
          });
          const { title: nextTitle, body: nextBody } = splitTitleBody(edited);
          if (nextTitle.length === 0) {
            console.log(chalk.yellow("⚠ Empty title — keeping original."));
          } else {
            draft = { ...draft, title: nextTitle, body: nextBody };
          }
        }
      }

      // 6. Dry-run exits here
      if (options.dryRun) {
        console.log(
          chalk.yellow(
            "Dry-run — no push, no PR created. Re-run without --dry-run to apply.",
          ),
        );
        return;
      }

      // 7. Confirm
      if (!options.autoApprove) {
        const ok = await confirm({
          message: `Push ${branch} and open this PR?`,
          default: true,
        });
        if (!ok) {
          console.log(chalk.dim("Aborted."));
          return;
        }
      }

      // 8. Push (set upstream — assume first push for the branch)
      const pushSpinner = ora({
        text: `Pushing ${branch} to origin...`,
        color: "cyan",
      }).start();
      try {
        await git.push(branch, { setUpstream: true });
        pushSpinner.succeed("Pushed");
      } catch (err) {
        pushSpinner.fail((err as Error).message);
        process.exit(1);
      }

      // 9. Create PR
      const prSpinner = ora({ text: "Creating PR...", color: "cyan" }).start();
      let result;
      try {
        result = await createPR({
          owner: repo.owner,
          repo: repo.repo,
          head: branch,
          base: effectiveBase,
          title: draft.title,
          body: draft.body,
        });
        prSpinner.succeed(`PR #${result.number} created`);
      } catch (err) {
        prSpinner.fail((err as Error).message);
        process.exit(1);
      }

      // 10. Apply labels (optional, non-fatal on failure)
      if (draft.labels.length > 0) {
        try {
          await addLabels(repo.owner, repo.repo, result.number, draft.labels);
          console.log(chalk.dim(`  Applied labels: ${draft.labels.join(", ")}`));
        } catch (err) {
          console.error(
            chalk.yellow(
              `⚠ Couldn't apply labels: ${(err as Error).message}`,
            ),
          );
        }
      }

      console.log("");
      console.log(chalk.green(`✓ ${result.url}`));
    },
  );

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
