/**
 * Slash-command + skill templates dropped by `pritty init` into the
 * user's repo. Authored as TypeScript template literals so they can
 * reference shared content (e.g. config snippets) without separate
 * file management. Each is consumed by exactly one command (init).
 */

/**
 * Claude Code slash-command bodies dropped into `.claude/commands/`.
 * When the user types `/commit` or `/pr` in Claude Code, the agent
 * reads the matching body and runs the corresponding `pritty`
 * invocation via the Bash tool.
 */
export const CLAUDE_COMMANDS: Record<string, string> = {
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

If pritty isn't installed, suggest \`npm install -g @helmsmith/pritty\` (or workspace-link from agentx-toolbox).
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
 * Slash commands fire on explicit `/commit` / `/pr` typing; the
 * skill fires on natural-language intent ("commit these changes",
 * "open a PR for this", "clean up the history") and teaches Claude
 * Code to delegate to pritty.
 */
export const PRITTY_SKILL = `---
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
   suggest \`npm install -g @helmsmith/pritty\` (or
   \`toolz install pritty\` if the user has @helmsmith/toolz set up).
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
 * VS Code Copilot Chat prompt files dropped by `pritty init` into
 * `.github/prompts/`. When the user types `/commit` or `/pr` in
 * Copilot Chat (or selects via the prompt picker), the agent runs
 * these instructions.
 */
export const COPILOT_PROMPTS: Record<string, string> = {
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
