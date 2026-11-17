---
name: pritty
description: AI-powered commit & PR creation. Fires when the user wants to commit staged changes, write a commit message, open a pull request, draft a PR description, or rebase a feature branch — phrases like "commit these changes", "make a commit", "open a PR", "create a pull request", "rebase this branch", "clean up the commit history", "what should this commit message be", "write me a PR description", "wrap up this work". Pritty handles per-change, per-category AI commit messages, AI PR title + body (respecting .github/pull_request_template.md), ticket detection from branch / commits / Jira / Linear, Claude Code, GitHub Copilot, Anthropic or OpenAI providers, and pushes via Octokit with auto-requested CODEOWNERS reviewers. Runs as a CLI: `pritty commit`, `pritty pr`, `pritty rebase`.
---

# pritty

> Where pritty sits in a feature's life (`work pr` pushes first, then pritty opens the PR with the repository's conventions): [The life of a worktree](https://github.com/JefeLabs/helmsmith/blob/main/docs/work-lifecycle.md).

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
  commit --amend` directly; pritty's commit flow is per-change, per-category
  forward, not history-rewriting per commit)

## What pritty does

| Command | Effect |
|---|---|
| `pritty commit` | Commit staged files: AI messages per change, per category (path-restricted commits), or no model at all: one commit from `--label --type --scope --message`, or the commits of a JSON body (`--input=json`) |
| `pritty pr` | Generate AI PR title + body (filling `.github/pull_request_template.md` when present), push, create the PR via Octokit, auto-request reviewers from `.github/CODEOWNERS` |
| `pritty rebase` | AI-planned interactive rebase to clean up history. Mandatory confirm; no `--auto-approve` |
| `pritty init` | Set up a project — writes the config (`.helmsmith/pritty.json`, or `.pritty.json` without a `.helmsmith` folder), slash commands, this skill |
| `pritty auth login` | GitHub Copilot Device Flow → `~/.pritty/auth.json` |

Every command takes `--output=json` (`--json` is the shorthand): one JSON
line on stdout (the result), everything else on stderr. `rebase --json`
still asks before rewriting history; use `rebase --dry-run --output=json`
for the plan.

## Pre-conditions to verify before invoking

Before running any pritty command, check:

1. **Working in a git repo** — `.git/` exists. If not, suggest
   `git init` first.
2. **pritty is installed** — `which pritty` succeeds. If not,
   suggest `npm install -g @helmsmith/pritty` (or
   `toolz install pritty` if the user has @helmsmith/toolz set up).
3. **An AI provider is available** — the default `claude` provider
   needs Claude Code on PATH (`which claude` succeeds) and logged in
   (run `claude` once). For another provider, set `provider` in
   `.pritty.json` and suggest `pritty auth login` (Copilot; listed by
   `pritty auth status`) or an API key (`ANTHROPIC_API_KEY` /
   `OPENAI_API_KEY`).
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
- `--no-verify` (commit) passes `--no-verify` to `git commit`, skipping
  the pre-commit and commit-msg hooks; only when the user approved
  bypassing a hook
- `--no-footer` (pr) leaves `prFooter` out of the body
- `--label <label>` (commit) starts every subject with a label, a ticket
  or effort name: trimmed, upper-cased, spaces joined by `-` (`status
  logging` becomes `STATUS-LOGGING`); `/`, `_`, `--` and punctuation are
  refused. Refused under the `gitmoji` and `simple` commit styles
- `--scope <path>` (commit) sets every commit's scope: one to three
  lowercase segments (`network`, `org/global`, `org/network/directory`)
- `--type <type>` (commit) sets the code commits' type (`fix` for a fix on
  a non-`fix/` branch); test and story commits keep theirs
- `--breaking` (commit, with `--message`) marks a breaking change: `!` after
  the scope
- `--trailer "Token: value"` (commit, repeatable) adds a trailer such as
  `Refs: plan-5 T9` to every commit, after `commitTrailers`
- `--strategy interactive|squash|fixup|auto` for rebase strategy
- `--output=json` (any command) is `--json`; `--output=text` is the default
- `--title`, `--body` / `--body-file` (pr) use your words, no model; a label
  every commit shares, and its tags, are added to the title when missing.
  `--input=json` (pr) reads `{ "title", "body"?, "draft"?, "labels"? }` from
  stdin, unattended

## Committing as an agent (no model call)

When you already know what each commit says, hand pritty the words. It
checks them, normalises the label, adds trailers and commits only the
staged paths; the index content, never the working tree. Stage first
(`git add`), and use the repository's `.pritty.json` conventions: the
`conventional` or `angular` commit style.

One call per commit, code before tests, with the paths after `--`
(resolved from the current directory, like `git add`; they must be staged,
and a `--message` call needs `--type` and `--scope`, plus `--label` where the
repository sets `commitLabels`; `--breaking` adds `!` after the scope):

```
pritty commit --label STATUS-LOGGING --type fix --scope issue-report \
  --message "log only exception class when status apply fails" \
  --output=json -- src/StatusConsumer.java
pritty commit --label STATUS-LOGGING --type test --scope issue-report \
  --message "assert failed status apply logs no exception text" \
  --output=json -- src/StatusConsumerTest.java
```

The description (`--message`) is one line, with no space before or after
it, a lower-case first word and no trailing period; more lines go in `--body`.
Paths after `--` without `--message` are refused. Or all commits in one call,
a JSON body on stdin (optional fields end in `?`; `files` are
repository-root-relative, as the output prints them):

```
{ "commits": [{ label?, type, scope, breaking?, description, body?, files? }] }
```

```
echo '{"commits":[{"label":"STATUS-LOGGING","type":"fix","scope":"issue-report",
  "description":"log only exception class","files":["src/A.java"]}]}' \
  | pritty commit --input=json --output=json
```

`label` is required where the repository sets `commitLabels`;
`"breaking": true` puts `!` after the scope; `files` may be left out only for
a single commit, which then takes every staged file. With `--input=json` the
flags `--label`, `--type`, `--scope`, `--message`, `--body`, `--breaking` and
`--` paths are refused; `--trailer`, `--no-verify`, `--dry-run` and
`--output` still apply. It runs unattended (no confirmation prompt). One
category per commit: a file set that spans code and tests is refused, so keep
them in separate commits.

`--dry-run --output=json` prints the plan, the same JSON without `sha`, and
touches nothing; feed it straight back through `--input=json` to commit it.
Each commit in the output has `category`, `message` (the labelled first
line as committed), `label`, `type`, `scope`, `breaking` (when true),
`description`, `body` (when present), `files` and `sha`.

Interactive `pritty commit` labels its commits only where `commitLabels` is
`true`: an explicit `--label`, else the ticket detected (repositories with a
`ticket` block), else, attended, a prompt, else the model's change names.

`pritty pr` titles a branch whose non-merge commits all share one label
`LABEL: summary [types] [scopes]`; otherwise `type(scope): summary`. A
`--title` or JSON title gets the label and tags added when missing.

After `pritty commit --dry-run`, a real `pritty commit` commits the
plan the dry run showed (no second model call) as long as HEAD and the
staged changes are unchanged; run `--dry-run` again for a fresh draft.
Commits are ordered code first, then tests, then stories, and on a
`fix/…` branch a `feat`, `build` or `chore` code commit is typed `fix`.

Surface pritty's output verbatim — its colored prompts, plan
previews, and confirmations are designed to be read.

## Anti-patterns

Do not:

- **Run `git commit` directly** when the user asked for an AI commit
  message — call `pritty commit` instead. The whole point of pritty
  existing is the categorize-and-commit-per-bucket flow.
- **Skip the confirmation flow** of an interactive run unless the user
  explicitly passed `--auto-approve`. Pritty's prompts are part of the
  contract. `--output=json` and `--input=json` run unattended by design:
  there, `--dry-run --output=json` is the preview.
- **Run `pritty rebase --auto-approve`** — pritty itself rejects
  this; rebase rewrites history and gets the friction it deserves.
- **Re-implement what pritty does** in shell scripting — pritty
  centralizes git wrap-up so the team's conventions stay consistent.
- **Write your own commit message and pass it to `git commit -m`.**
  When you know the message, give it to pritty: `--label --type --scope
  --message -- <paths>` (one call per commit, code before tests) or a JSON
  body with `--input=json`. When the user wanted AI-generated content, run
  plain `pritty commit`.

## Config reference

Pritty looks for `.helmsmith/pritty.json` (or `.yaml` / `.yml`) or
`.pritty.json` (or .yaml / .prittyrc variants) in the repo, nearest
directory first. If both sit in one directory they must hold the same
config, or pritty refuses to run. `pritty init` scaffolds one, in
`.helmsmith/` when the repo has that folder. Common fields:

```jsonc
{
  "model": "claude-opus-5-5",
  "baseBranch": "main",
  "commitStyle": "conventional",
  "commitLabels": false,                    // true: every commit subject starts with a label
  "provider": "claude",                     // or "copilot" / "anthropic" / "openai"
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

See `apps/pritty/README.md` in the helmsmith repo for the full
config reference.
