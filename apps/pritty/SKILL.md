---
name: pritty
description: AI-powered commit & PR creation. Fires when the user wants to commit staged changes, write a commit message, open a pull request, draft a PR description, or rebase a feature branch — phrases like "commit these changes", "make a commit", "open a PR", "create a pull request", "rebase this branch", "clean up the commit history", "what should this commit message be", "write me a PR description", "wrap up this work". Pritty handles per-category AI commit messages, AI PR title + body (respecting .github/pull_request_template.md), ticket detection from branch / commits / Jira / Linear, GitHub Copilot or Anthropic or OpenAI providers, and pushes via Octokit with auto-requested CODEOWNERS reviewers. Runs as a CLI: `pritty commit`, `pritty pr`, `pritty rebase`.
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
- The user wants to amend a *single past* commit (use `git
  commit --amend` directly; pritty's commit flow is per-category
  forward, not history-rewriting per commit)

## What pritty does

| Command | Effect |
|---|---|
| `pritty commit` | Categorize staged files, generate AI commit messages per category, commit each separately via path-restricted commits |
| `pritty pr` | Generate AI PR title + body (filling `.github/pull_request_template.md` when present), push, create the PR via Octokit, auto-request reviewers from `.github/CODEOWNERS` |
| `pritty rebase` | AI-planned interactive rebase to clean up history. Mandatory confirm; no `--auto-approve` |
| `pritty init` | Set up a project — writes `.pritty.json`, slash commands, this skill |
| `pritty auth login` | GitHub Copilot Device Flow → `~/.pritty/auth.json` |

## Pre-conditions to verify before invoking

Before running any pritty command, check:

1. **Working in a git repo** — `.git/` exists. If not, suggest
   `git init` first.
2. **pritty is installed** — `which pritty` succeeds. If not,
   suggest `npm install -g @agentx/pritty` (or
   `toolz install pritty` if the user has @agentx/toolz set up).
3. **User has authenticated** — `pritty auth status` shows a
   provider. If not, suggest `pritty auth login` (Copilot) or
   setting an API key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`).
4. **Per-command preconditions:**
   - `commit`: at least one staged file
     (`git diff --cached --name-only`)
   - `pr`: branch is ahead of base
     (`git log <base>..HEAD` returns commits)
   - `rebase`: working tree clean, not on `main`/`master`/`develop`,
     more than one commit ahead of base

## How to invoke

Pritty runs in the user's terminal — call it via the Bash tool with
the user's repo as cwd. Pass through any flags the user mentions:

- `--auto-approve` skips confirmation prompts (commit / pr only;
  rebase always requires manual confirm)
- `--dry-run` previews without touching git
- `--commit-style conventional|gitmoji|angular|simple` for one-off
  override
- `--base <branch>` for PR base override
- `--strategy interactive|squash|fixup|auto` for rebase strategy

Surface pritty's output verbatim — its colored prompts, plan
previews, and confirmations are designed to be read.

## Anti-patterns

Do not:

- **Run `git commit` directly** when the user asked for an AI commit
  message — call `pritty commit` instead. The whole point of pritty
  existing is the categorize-and-commit-per-bucket flow.
- **Skip the confirmation flow** unless the user explicitly passed
  `--auto-approve`. Pritty's prompts are part of the contract.
- **Run `pritty rebase --auto-approve`** — pritty itself rejects
  this; rebase rewrites history and gets the friction it deserves.
- **Re-implement what pritty does** in shell scripting — pritty
  centralizes git wrap-up so the team's conventions stay consistent.
- **Write your own commit message and pass it to `git commit -m`**
  when the user wanted AI-generated content. That's bypassing the
  skill they invoked you to use.

## Config reference

Pritty looks for `.pritty.json` (or .yaml / .prittyrc variants) in
the repo. `pritty init` scaffolds one. Common fields:

```jsonc
{
  "model": "gpt-4o",
  "baseBranch": "main",
  "commitStyle": "conventional",
  "provider": "copilot",                    // or "anthropic" / "openai"
  "fallback": [],                           // opt-in multi-provider
  "ticket": {
    "pattern": "[A-Z]+-\\d+",
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
```

See `apps/pritty/README.md` in the agentx-toolbox repo for the full
config reference.
