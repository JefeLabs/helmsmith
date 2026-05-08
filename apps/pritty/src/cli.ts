/**
 * Pritty CLI. Phase-2 surface: auth, init, categorize, commit.
 * pr/rebase/hooks land in follow-up phases — wired as CLI stubs so
 * users learn the surface exists.
 */

import { Command } from "commander";
import chalk from "chalk";
import { confirm, editor } from "@inquirer/prompts";
import ora from "ora";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  generateCommitMessages,
  generatePR,
  generateRebasePlan,
  type CommitMessage,
  type RebasePlan,
  type RebaseStep,
  type TicketContext,
} from "./ai.js";
import { detectTicket, findRecentTicket, ticketLink } from "./ticket.js";
import { findPullRequestTemplate } from "./pr-template.js";
import { detectShell, installShellAliases } from "./shell-aliases.js";
import {
  buildAdapter,
  deriveLinkTemplate,
  type ValidationResult,
} from "./adapters/index.js";
import {
  clearCache,
  getCachedTicket,
  getCachePath,
  setCachedTicket,
} from "./adapters/cache.js";
import {
  addLabels,
  createPR,
  getDefaultBranch,
  listOpenPRsForHead,
  requestReviewers,
} from "./github.js";
import { parseGitHubRemote } from "./git.js";
import {
  findCodeowners,
  parseCodeowners,
  resolveReviewers,
} from "./codeowners.js";
import { getAuthPath, login as authLogin, logout as authLogout, readAuth } from "./auth.js";
import { defaultStarterConfig, loadConfig } from "./config.js";
import {
  categorize,
  mergeCategories,
  UNKNOWN_CATEGORY,
} from "./categorizer.js";
import { createGit } from "./git.js";

/**
 * Resolve the active ticket context from config + branch + history.
 *
 * Resolution chain:
 *   1. Detect from branch name → use silently
 *   2. If `inferFromCommits: true` and no branch ticket: scan recent
 *      commits on this branch
 *      a. If most recent ticket is within `freshWindowHours` → use silently
 *      b. If older than that → prompt y/N (default N) before reusing
 *   3. If `validate: true` and still no ticket → fast-fail
 *   4. Otherwise return whatever ticket was resolved (possibly null)
 *
 * The async signature is required because the inference path may
 * shell out to git log and may prompt the user.
 */
async function resolveTicketContext(
  config: ReturnType<typeof loadConfig>,
  branch: string,
  git: ReturnType<typeof createGit>,
): Promise<TicketContext | undefined> {
  if (!config.ticket) return undefined;

  // 1. Branch-name detection — fastest path, no IO
  let ticket = detectTicket(branch, config.ticket.pattern);

  // 2. Recent-commit fallback (opt-in)
  if (!ticket && config.ticket.inferFromCommits) {
    const commits = await git.recentCommitsOnBranch(20);
    const recent = findRecentTicket(commits, config.ticket.pattern);
    if (recent) {
      const fresh = recent.ageHours <= config.ticket.freshWindowHours;
      if (fresh) {
        ticket = recent.ticket;
        console.log(
          chalk.dim(
            `  (using ${ticket} from recent commit "${recent.fromSubject}", ${formatAge(recent.ageHours)} ago)`,
          ),
        );
      } else {
        // Stale — ask before reusing
        const useIt = await confirm({
          message: `Reuse ticket ${recent.ticket} from commit ${formatAge(recent.ageHours)} ago ("${truncateSubject(recent.fromSubject, 50)}")?`,
          default: false,
        });
        if (useIt) ticket = recent.ticket;
      }
    }
  }

  // 3. Validation gate (pattern level)
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

  // 4. Live validation via adapter (cached). Only fires when both a
  //    ticket is present AND `validation` is configured. Cache hits
  //    short-circuit; misses call the adapter and persist the result.
  let title: string | undefined;
  let resolvedLink = ticketLink(ticket, config.ticket.linkTemplate);
  if (ticket && config.ticket.validation) {
    const validation = config.ticket.validation;
    const cached = getCachedTicket(ticket, validation.type);
    let result: ValidationResult | null;
    if (cached) {
      result = {
        exists: cached.exists,
        ...(cached.title ? { title: cached.title } : {}),
        ...(cached.status ? { status: cached.status } : {}),
        ...(cached.url ? { url: cached.url } : {}),
      };
    } else {
      try {
        const adapter = await buildAdapter(validation);
        result = await adapter.validate(ticket);
      } catch (err) {
        console.error(
          chalk.yellow(
            `⚠ Ticket validation failed: ${(err as Error).message}`,
          ),
        );
        result = null;
      }
      if (result) {
        setCachedTicket(ticket, validation.type, {
          exists: result.exists,
          ...(result.title ? { title: result.title } : {}),
          ...(result.status ? { status: result.status } : {}),
          ...(result.url ? { url: result.url } : {}),
        });
      }
    }

    if (result) {
      if (!result.exists && config.ticket.validateStrict) {
        console.error(
          chalk.red(
            `✗ ${ticket} not found in ${validation.type}: ${result.error ?? "ticket missing"}`,
          ),
        );
        console.error(
          chalk.dim(`  Set ticket.validateStrict: false to proceed anyway.`),
        );
        process.exit(1);
      }
      if (!result.exists) {
        console.log(
          chalk.yellow(
            `⚠ ${ticket} not found in ${validation.type}; proceeding anyway.`,
          ),
        );
      } else {
        title = result.title;
        if (result.url) resolvedLink = result.url;
      }
    } else {
      // Adapter returned null (network/credentials issue). Don't
      // block — note it and let the AI proceed with the bare ticket.
      console.log(
        chalk.dim(
          `  (couldn't verify ${ticket} via ${validation.type}; using anyway)`,
        ),
      );
    }
  }

  // Auto-derive link template when only validation config is set
  if (!resolvedLink && config.ticket.validation && ticket) {
    const derived = deriveLinkTemplate(config.ticket.validation);
    resolvedLink = ticketLink(ticket, derived);
  }

  return {
    ticket,
    link: resolvedLink,
    title,
  };
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function truncateSubject(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * Render a rebase plan as the TODO file git expects (oldest-first,
 * one action per line). When a step has a message and the action
 * permits one (reword / squash / pick — git ignores it on fixup /
 * drop), we append it after the hash so the rebase TODO carries the
 * intended subject. The actual message edit happens during the
 * rebase itself when git pauses on `reword`.
 */
function renderRebaseTodo(steps: readonly RebaseStep[]): string {
  const lines: string[] = [];
  for (const step of steps) {
    if (step.action === "drop") {
      // git accepts a literal "drop <hash>" line; comment it for the
      // human reading the TODO file.
      lines.push(`drop ${step.hash}`);
      continue;
    }
    const trail = step.message ? ` ${step.message}` : "";
    lines.push(`${step.action} ${step.hash}${trail}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Slash-command template bodies dropped by `pritty init` into the
 * repo's `.claude/commands/` directory. Each is a Claude Code
 * command file: when the user types `/commit` or `/pr` in Claude
 * Code, the agent reads this body and runs the corresponding
 * `pritty` invocation via the Bash tool.
 */
const CLAUDE_COMMANDS: Record<string, string> = {
  commit: `---
description: Generate AI commit messages per category and commit each group via pritty.
allowed-tools: Bash
argument-hint: "[--auto-approve] [--dry-run] [--commit-style conventional|gitmoji|angular|simple]"
---

Run \`pritty commit\` in the current repo. Pass any flags the user provides through.

The command will:
1. Read staged files (run \`git add\` first if needed)
2. Categorize them via .pritty.json's category map
3. Generate per-category commit messages via AI
4. Show the plan and confirm before committing
5. Optionally let the user edit each message
6. Create one commit per category using path-restricted \`git commit -- <files>\`

If pritty isn't installed, suggest \`npm install -g @agentx/pritty\` (or workspace-link from agentx-toolbox).
`,

  pr: `---
description: Generate AI pull-request title + body via pritty, push, and open the PR on GitHub.
allowed-tools: Bash
argument-hint: "[--base <branch>] [--auto-approve] [--dry-run]"
---

Run \`pritty pr\` in the current repo. Pass any flags the user provides through.

The command will:
1. Resolve the current branch + origin remote → owner/repo
2. Find commits between base and HEAD
3. Auto-detect .github/PULL_REQUEST_TEMPLATE.md if present
4. Generate title + body + labels via AI
5. Show preview and confirm
6. Push the branch (-u on first push)
7. Create the PR via Octokit
8. Apply labels + auto-request reviewers from .github/CODEOWNERS

If \`pr\` reports a config issue (no GitHub token, no remote), surface the message verbatim and suggest running \`pritty auth login\` first.
`,
};

/**
 * Standalone Claude Code skill body — broader than the slash commands.
 * Slash commands fire when the user explicitly types `/commit` or
 * `/pr`. The skill fires on natural-language intent ("can you commit
 * these changes", "open a PR for this", "clean up the history") and
 * teaches Claude Code to delegate to pritty.
 *
 * Dropped by `pritty init` into `.claude/skills/pritty/SKILL.md` for
 * users who install pritty independently and want the skill in their
 * project. Also shipped as `SKILL.md` at the package root so users
 * can copy it to `~/.claude/skills/pritty/SKILL.md` for user-scoped
 * activation.
 */
const PRITTY_SKILL = `---
name: pritty
description: AI-powered commit & PR creation. Fires when the user wants to commit staged changes, write a commit message, open a pull request, draft a PR description, or rebase a feature branch — phrases like "commit these changes", "make a commit", "open a PR", "create a pull request", "rebase this branch", "clean up the commit history", "what should this commit message be", "write me a PR description", "wrap up this work". Pritty handles per-category AI commit messages, AI PR title + body (respecting .github/pull_request_template.md), ticket detection from branch / commits / Jira / Linear, GitHub Copilot or Anthropic or OpenAI providers, and pushes via Octokit with auto-requested CODEOWNERS reviewers. Runs as a CLI: \`pritty commit\`, \`pritty pr\`, \`pritty rebase\`.
---

# pritty

A CLI for AI-driven git wrap-up — commits, PRs, and rebases. Designed
to *speed* the wrap-up: invisible enrichment from repo signals
(commitlint config, PR template, CODEOWNERS, ticket patterns), default
keystrokes that ship work, prompts only when there's a real choice to
make.

## When to fire this skill

Strong triggers — fire without hesitation:

- "commit these changes" / "make a commit"
- "open a PR" / "create a pull request" / "draft a PR for this"
- "rebase this branch" / "clean up the commit history"
- "write me a PR description"
- "what should this commit message be"
- "wrap up this work"

Soft triggers — fire when the surrounding context confirms intent:

- The user has staged changes and asks "what's next?"
- A PR review just merged and the user mentions follow-up
- The user describes finishing work that produces a wrap-up moment

Don't fire when:

- The user is debugging a failing commit hook (they need the hook
  fixed, not pritty invoked)
- The user is mid-rebase and asks for git mechanics help
- The user wants to amend a *single past* commit (use \`git
  commit --amend\` directly; pritty's commit flow is per-category
  forward, not history-rewriting per commit)

## What pritty does

| Command | Effect |
|---|---|
| \`pritty commit\` | Categorize staged files, generate AI commit messages per category, commit each separately via path-restricted commits |
| \`pritty pr\` | Generate AI PR title + body (filling \`.github/pull_request_template.md\` when present), push, create the PR via Octokit, auto-request reviewers from \`.github/CODEOWNERS\` |
| \`pritty rebase\` | AI-planned interactive rebase to clean up history. Mandatory confirm; no \`--auto-approve\` |
| \`pritty init\` | Set up a project — writes \`.pritty.json\`, slash commands, this skill |
| \`pritty auth login\` | GitHub Copilot Device Flow → \`~/.pritty/auth.json\` |

## Pre-conditions to verify before invoking

Before running any pritty command, check:

1. **Working in a git repo** — \`.git/\` exists. If not, suggest
   \`git init\` first.
2. **pritty is installed** — \`which pritty\` succeeds. If not,
   suggest \`npm install -g @agentx/pritty\` (or
   \`toolz install pritty\` if the user has @agentx/toolz set up).
3. **User has authenticated** — \`pritty auth status\` shows a
   provider. If not, suggest \`pritty auth login\` (Copilot) or
   setting an API key (\`ANTHROPIC_API_KEY\` / \`OPENAI_API_KEY\`).
4. **Per-command preconditions:**
   - \`commit\`: at least one staged file
     (\`git diff --cached --name-only\`)
   - \`pr\`: branch is ahead of base
     (\`git log <base>..HEAD\` returns commits)
   - \`rebase\`: working tree clean, not on \`main\`/\`master\`/\`develop\`,
     more than one commit ahead of base

## How to invoke

Pritty runs in the user's terminal — call it via the Bash tool with
the user's repo as cwd. Pass through any flags the user mentions:

- \`--auto-approve\` skips confirmation prompts (commit / pr only;
  rebase always requires manual confirm)
- \`--dry-run\` previews without touching git
- \`--commit-style conventional|gitmoji|angular|simple\` for one-off
  override
- \`--base <branch>\` for PR base override
- \`--strategy interactive|squash|fixup|auto\` for rebase strategy

Surface pritty's output verbatim — its colored prompts, plan
previews, and confirmations are designed to be read.

## Anti-patterns

Do not:

- **Run \`git commit\` directly** when the user asked for an AI commit
  message — call \`pritty commit\` instead. The whole point of pritty
  existing is the categorize-and-commit-per-bucket flow.
- **Skip the confirmation flow** unless the user explicitly passed
  \`--auto-approve\`. Pritty's prompts are part of the contract.
- **Run \`pritty rebase --auto-approve\`** — pritty itself rejects
  this; rebase rewrites history and gets the friction it deserves.
- **Re-implement what pritty does** in shell scripting — pritty
  centralizes git wrap-up so the team's conventions stay consistent.
- **Write your own commit message and pass it to \`git commit -m\`**
  when the user wanted AI-generated content. That's bypassing the
  skill they invoked you to use.

## Config reference

Pritty looks for \`.pritty.json\` (or .yaml / .prittyrc variants) in
the repo. \`pritty init\` scaffolds one. Common fields:

\`\`\`jsonc
{
  "model": "gpt-4o",
  "baseBranch": "main",
  "commitStyle": "conventional",
  "provider": "copilot",                    // or "anthropic" / "openai"
  "fallback": [],                           // opt-in multi-provider
  "ticket": {
    "pattern": "[A-Z]+-\\\\d+",
    "validate": false,
    "validation": {
      "type": "jira-rest",
      "baseUrl": "https://yourorg.atlassian.net"
    }
  },
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],
    "app": ["src/**", "lib/**"]
  }
}
\`\`\`

See \`apps/pritty/README.md\` in the agentx-toolbox repo for the full
config reference.
`;

/**
 * VS Code Copilot Chat prompt files dropped by \`pritty init\` into
 * \`.github/prompts/\`. When the user types \`/commit\` or \`/pr\` in
 * Copilot Chat (or selects via the prompt picker), the agent runs
 * these instructions.
 */
const COPILOT_PROMPTS: Record<string, string> = {
  commit: `---
name: commit
description: Generate AI commit messages per category and commit each group via pritty
---

Run \`pritty commit\` in the integrated terminal. This will:

1. Read staged files (\`git add\` your changes first)
2. Categorize them per the project's .pritty.json
3. Generate one commit message per file category using AI
4. Show the plan; press Enter to accept or \`y\` to edit any message
5. Commit each category as a separate path-restricted commit

Useful flags:
  \`--dry-run\` — show the plan without committing
  \`--auto-approve\` — skip the confirmation prompts
  \`--commit-style conventional|gitmoji|angular|simple\` — override the project default
`,

  pr: `---
name: pr
description: Generate AI pull-request title + body and open it on GitHub via pritty
---

Run \`pritty pr\` in the integrated terminal. This will:

1. Detect the current branch + GitHub remote
2. Generate a title, body (filling \`.github/pull_request_template.md\` when present), and labels via AI
3. Show the preview; press Enter to confirm
4. Push the branch and create the PR via the GitHub API
5. Auto-request reviewers from \`.github/CODEOWNERS\`

Useful flags:
  \`--base <branch>\` — override the base branch (defaults to repo's default)
  \`--dry-run\` — preview without pushing or creating the PR
  \`--auto-approve\` — skip confirmations
`,
};

/** Color the action verb in the plan preview. */
function colorAction(action: RebaseStep["action"]): string {
  switch (action) {
    case "pick":
      return chalk.green("pick   ");
    case "reword":
      return chalk.cyan("reword ");
    case "squash":
      return chalk.yellow("squash ");
    case "fixup":
      return chalk.yellow("fixup  ");
    case "drop":
      return chalk.red("drop   ");
  }
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
  .description(
    "Write a starter .pritty.json + Claude Code / VS Code Copilot slash commands. Skips integration files outside a git repo.",
  )
  .option("--force", "Overwrite existing files")
  .option("--no-claude", "Skip writing .claude/commands/{commit,pr}.md")
  .option("--no-copilot", "Skip writing .github/prompts/{commit,pr}.prompt.md")
  .option("--no-aliases", "Skip the shell-alias prompt for `commit` / `pr`")
  .option("--no-skill", "Skip writing .claude/skills/pritty/SKILL.md")
  .action(
    async (options: {
      force?: boolean;
      claude?: boolean;
      copilot?: boolean;
      aliases?: boolean;
      skill?: boolean;
    }) => {
      const cwd = process.cwd();
      const force = options.force ?? false;
      const includeClaude = options.claude !== false;
      const includeCopilot = options.copilot !== false;
      const includeAliases = options.aliases !== false;
      const includeSkill = options.skill !== false;
      const inGitRepo = existsSync(join(cwd, ".git"));

      let written = 0;
      let skipped = 0;

      // 1. .pritty.json (always)
      const configPath = join(cwd, ".pritty.json");
      if (existsSync(configPath) && !force) {
        console.log(chalk.dim(`· skipped ${configPath} (exists; --force to overwrite)`));
        skipped++;
      } else {
        writeFileSync(
          configPath,
          JSON.stringify(defaultStarterConfig(), null, 2) + "\n",
        );
        console.log(chalk.green(`✓ ${configPath}`));
        written++;
      }

      // 2. Claude Code slash commands (in git repos only)
      if (includeClaude && inGitRepo) {
        const claudeDir = join(cwd, ".claude", "commands");
        for (const [name, body] of Object.entries(CLAUDE_COMMANDS)) {
          const path = join(claudeDir, `${name}.md`);
          if (existsSync(path) && !force) {
            console.log(chalk.dim(`· skipped ${path} (exists; --force to overwrite)`));
            skipped++;
            continue;
          }
          mkdirSync(claudeDir, { recursive: true });
          writeFileSync(path, body);
          console.log(chalk.green(`✓ ${path}`));
          written++;
        }
      }

      // 2.5. Standalone Claude Code skill (in git repos only).
      // Broader than the slash commands — fires on natural-language
      // intent ("can you commit this", "open a PR") rather than just
      // explicit /commit / /pr typing.
      if (includeSkill && inGitRepo) {
        const skillDir = join(cwd, ".claude", "skills", "pritty");
        const skillPath = join(skillDir, "SKILL.md");
        if (existsSync(skillPath) && !force) {
          console.log(chalk.dim(`· skipped ${skillPath} (exists; --force to overwrite)`));
          skipped++;
        } else {
          mkdirSync(skillDir, { recursive: true });
          writeFileSync(skillPath, PRITTY_SKILL);
          console.log(chalk.green(`✓ ${skillPath}`));
          written++;
        }
      }

      // 3. VS Code Copilot Chat prompts (in git repos only)
      if (includeCopilot && inGitRepo) {
        const promptDir = join(cwd, ".github", "prompts");
        for (const [name, body] of Object.entries(COPILOT_PROMPTS)) {
          const path = join(promptDir, `${name}.prompt.md`);
          if (existsSync(path) && !force) {
            console.log(chalk.dim(`· skipped ${path} (exists; --force to overwrite)`));
            skipped++;
            continue;
          }
          mkdirSync(promptDir, { recursive: true });
          writeFileSync(path, body);
          console.log(chalk.green(`✓ ${path}`));
          written++;
        }
      }

      // 4. Optional shell aliases — interactive opt-in (default N).
      // Adds plain `commit` / `pr` aliases to the user's rc file so
      // they can skip the `pritty ` prefix. Idempotent — re-running
      // replaces the existing block instead of duplicating.
      if (includeAliases) {
        const shell = detectShell();
        if (shell) {
          const wantAliases = await confirm({
            message: `Add shell aliases (${chalk.bold("commit")} → ${chalk.bold("pritty commit")}, ${chalk.bold("pr")} → ${chalk.bold("pritty pr")}) to ~/.${shell === "fish" ? "config/fish/config.fish" : `${shell}rc`}?`,
            default: false,
          });
          if (wantAliases) {
            try {
              const result = installShellAliases(shell);
              console.log(
                chalk.green(
                  `✓ ${result.replaced ? "Updated" : "Added"} shell aliases in ${result.rcPath}`,
                ),
              );
              console.log(
                chalk.dim(
                  `  Run \`source ${result.rcPath}\` or open a new terminal to use them.`,
                ),
              );
              written++;
            } catch (err) {
              console.error(chalk.red(`✗ ${(err as Error).message}`));
            }
          }
        } else {
          console.log(
            chalk.dim(
              `\nUnrecognized shell ($SHELL=${process.env.SHELL ?? "(unset)"}); skipping alias prompt. Add manually: \`alias commit="pritty commit"\` \`alias pr="pritty pr"\``,
            ),
          );
        }
      }

      // 5. Summary
      if (!inGitRepo && (includeClaude || includeCopilot)) {
        console.log(
          chalk.dim(
            `\nNot a git repository (no .git/ found) — skipped Claude Code & Copilot integration files.`,
          ),
        );
      }
      console.log("");
      console.log(
        chalk.cyan(
          `${written} written, ${skipped} skipped${force ? " (force overwrites enabled)" : ""}`,
        ),
      );
      if (inGitRepo && (includeClaude || includeCopilot)) {
        console.log("");
        console.log(chalk.dim("Try it:"));
        if (includeClaude) console.log(chalk.dim("  Claude Code:  /commit  /pr"));
        if (includeCopilot) console.log(chalk.dim("  VS Code Chat: /commit  /pr"));
      }
    },
  );

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

// ─── cache ────────────────────────────────────────────────────────────

const cache = program
  .command("cache")
  .description("Manage the validated-ticket cache (~/.pritty/cache.json)");

cache
  .command("clear")
  .description("Wipe the validated-ticket cache")
  .action(() => {
    clearCache();
    console.log(chalk.green(`✓ Cleared ${getCachePath()}`));
  });

cache
  .command("path")
  .description("Print the cache file path (useful for inspection / scripting)")
  .action(() => {
    console.log(getCachePath());
  });

// ─── commit / pr / rebase ─────────────────────────────────────────────

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
      const ticketCtx = await resolveTicketContext(config, branch, git);
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

      // 4. AI-generate title + body + labels.
      // PR template (if present) is auto-detected from the GitHub
      // convention paths; passed to the AI as authoritative body
      // structure so generated content fits the team's existing PR
      // shape instead of pritty's default headings.
      const template = findPullRequestTemplate();
      if (template) {
        console.log(
          chalk.dim(
            `  (using PR template: ${template.path}${template.truncated ? " — truncated" : ""})`,
          ),
        );
      }

      const spinner = ora({ text: "Generating PR description...", color: "cyan" }).start();
      let draft;
      try {
        draft = await generatePR(
          commits,
          { branch, base: effectiveBase, owner: repo.owner, repo: repo.repo },
          config,
          ticketCtx,
          template,
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

      // 11. Auto-request reviewers from CODEOWNERS, if present
      const codeownersContent = findCodeowners();
      if (codeownersContent) {
        const rules = parseCodeowners(codeownersContent);
        const changedFiles = await git.changedFilesBetween(effectiveBase);
        const reviewers = resolveReviewers(changedFiles, rules);
        if (reviewers.users.length > 0 || reviewers.teams.length > 0) {
          try {
            await requestReviewers(
              repo.owner,
              repo.repo,
              result.number,
              reviewers.users,
              reviewers.teams,
            );
            const summary = [
              ...reviewers.users.map((u) => `@${u}`),
              ...reviewers.teams.map((t) => `@${repo.owner}/${t}`),
            ].join(", ");
            console.log(chalk.dim(`  Requested reviewers: ${summary}`));
          } catch (err) {
            console.error(
              chalk.yellow(
                `⚠ Couldn't request reviewers: ${(err as Error).message}`,
              ),
            );
          }
        }
      }

      console.log("");
      console.log(chalk.green(`✓ ${result.url}`));
    },
  );

program
  .command("rebase")
  .description("AI-planned interactive rebase over commits ahead of base branch")
  .option(
    "--strategy <strategy>",
    "interactive | squash | fixup | auto (default: interactive, or config.rebaseStrategy)",
  )
  .option("--base <branch>", "Base ref to rebase onto (default: config.baseBranch or main)")
  .option("--dry-run", "Show the plan; do NOT touch git")
  .action(
    async (options: {
      strategy?: string;
      base?: string;
      dryRun?: boolean;
    }) => {
      const config = loadConfig();
      const git = createGit();

      // Strategy resolution: CLI flag > config > default
      const validStrategies = ["interactive", "squash", "fixup", "auto"] as const;
      const strategy = (options.strategy as
        | (typeof validStrategies)[number]
        | undefined) ?? config.rebaseStrategy;
      if (!validStrategies.includes(strategy)) {
        console.error(
          chalk.red(
            `✗ Invalid --strategy "${strategy}". Valid: ${validStrategies.join(", ")}`,
          ),
        );
        process.exit(1);
      }

      // Preflight: working tree must be clean. Rebase rewrites
      // history; uncommitted work would get caught in the crossfire.
      if (!options.dryRun && !(await git.isWorkingTreeClean())) {
        console.error(
          chalk.red(
            "✗ Working tree not clean. Stash or commit your changes before rebasing.",
          ),
        );
        process.exit(1);
      }

      // Preflight: refuse to rebase shared default-ish branches.
      const branch = await git.getCurrentBranch();
      const protectedBranches = ["main", "master", "develop"];
      if (protectedBranches.includes(branch)) {
        console.error(
          chalk.red(
            `✗ Refusing to rebase ${branch} — that's a shared branch. Switch to a feature branch first.`,
          ),
        );
        process.exit(1);
      }

      const base = options.base ?? config.baseBranch;
      const commits = await git.log(base);
      if (commits.length === 0) {
        console.log(
          chalk.dim(
            `No commits between ${base} and ${branch}. Nothing to rebase.`,
          ),
        );
        return;
      }
      if (commits.length === 1) {
        console.log(
          chalk.dim(
            `Only one commit ahead of ${base} — nothing to consolidate.`,
          ),
        );
        return;
      }

      console.log(
        chalk.cyan(
          `Rebasing ${commits.length} commit(s) on ${branch} → ${base}  ${chalk.dim(`(strategy: ${strategy})`)}`,
        ),
      );
      for (const c of commits) {
        console.log(`  ${chalk.dim(c.hash.slice(0, 7))}  ${c.subject}`);
      }
      console.log("");

      // Generate plan
      const spinner = ora({ text: "Generating rebase plan...", color: "cyan" }).start();
      let plan: RebasePlan;
      try {
        plan = await generateRebasePlan(commits, strategy, config);
        spinner.succeed("Plan ready");
      } catch (err) {
        spinner.fail((err as Error).message);
        process.exit(1);
      }

      // Show plan (oldest-first matches git rebase TODO order)
      console.log("");
      console.log(chalk.cyan("Plan (oldest first):"));
      for (const step of plan.steps) {
        const tag = colorAction(step.action);
        const message = step.message ? ` — ${chalk.green(step.message)}` : "";
        const rationale = step.rationale ? ` ${chalk.dim(`(${step.rationale})`)}` : "";
        console.log(
          `  ${tag} ${chalk.dim(step.hash.slice(0, 7))}${message}${rationale}`,
        );
      }
      if (plan.summary) {
        console.log("");
        console.log(chalk.dim(`Summary: ${plan.summary}`));
      }
      console.log("");

      if (options.dryRun) {
        console.log(
          chalk.yellow(
            "Dry-run — git not touched. Re-run without --dry-run to execute.",
          ),
        );
        return;
      }

      // Always require explicit confirmation — no --auto-approve for
      // rebase. Destructive operations get the friction they deserve.
      const ok = await confirm({
        message: chalk.yellow(
          `This will rewrite history on ${branch}. Proceed?`,
        ),
        default: false,
      });
      if (!ok) {
        console.log(chalk.dim("Aborted. No changes made."));
        return;
      }

      // Execute via GIT_SEQUENCE_EDITOR
      const todoContent = renderRebaseTodo(plan.steps);
      const execSpinner = ora({
        text: `Rebasing on ${base}...`,
        color: "cyan",
      }).start();
      const result = await git.rebaseWithPlan(base, todoContent);
      if (result.ok) {
        execSpinner.succeed("Rebase complete");
      } else {
        execSpinner.fail("Rebase failed");
        console.error("");
        console.error(chalk.red(result.output));
        console.error("");
        console.error(
          chalk.yellow(
            "Your branch is now in a paused rebase state.\n" +
              "  Resolve conflicts, then `git rebase --continue`\n" +
              "  Or undo entirely:                `git rebase --abort`",
          ),
        );
        process.exit(1);
      }
    },
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
