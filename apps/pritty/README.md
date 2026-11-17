# 🎀 @helmsmith/pritty

> Where pritty sits in a feature's life (`work pr` pushes first, then pritty opens the PR with the repository's conventions): [The life of a worktree](https://github.com/JefeLabs/helmsmith/blob/main/docs/work-lifecycle.md).

**Pretty PRs, zero effort.** AI-powered CLI that categorizes staged
files by purpose, generates conventional commits, and creates pull
requests — with pluggable hooks and human-in-the-loop approval.

Part of the [helmsmith](../..) monorepo. Auth + multi-agent
adapters live in shared packages (`@helmsmith/agent-auth`,
`@helmsmith/agent-adapter`) so pritty doesn't reinvent OAuth or LLM
provider routing.

## Status

This is a **phased build** following the
[implementation plan](../../../helmsmith-pritty/pritty-implementation-plan.md).

| Phase | Status |
|---|---|
| Auth (login / logout / status via `@helmsmith/agent-auth`) | ✅ |
| Config (.pritty.json + Zod schema) | ✅ |
| Categorizer (default + custom glob categories) | ✅ |
| `pritty init` starter config | ✅ |
| `pritty categorize` (read-only file bucketing) | ✅ |
| AI client (multi-provider via `@helmsmith/agent-adapter`) | ✅ |
| `pritty commit` (AI commit messages per change, per category; one commit from args or a JSON body, no model; labels; index-only commits) | ✅ |
| `pritty pr` (AI-generated PR title + body, existing-PR reuse) | ✅ |
| `pritty rebase` (AI-planned rebase; a last resort — prefer a merge commit) | ✅ |
| Pre-commit / pre-push hook runner | removed — git hooks belong to the repository |
| Outlier detection + interactive resolution | ⏳ |

## Quick start

Requires Node 24 or newer (`npm install -g @helmsmith/pritty`).

```bash
pritty                                # shows command list (Commander default)
pritty auth login                     # GitHub Device Flow → ~/.pritty/auth.json
pritty auth status
pritty init                           # config, slash commands, skill, agent files (see Agent files)
pritty categorize                     # show staged files grouped by category
pritty categorize --all               # include modified + untracked
```

## Programmatic API

```typescript
import {
  login, readAuth, logout,
  loadConfig,
  categorize, mergeCategories, DEFAULT_CATEGORIES,
} from "@helmsmith/pritty";

// Use pritty's primitives in other tools without spawning the CLI.
const config = loadConfig();
const buckets = categorize(["src/index.ts", "test/foo.test.ts"]);
```

## Configuration

`.helmsmith/pritty.json` (or `.yaml` / `.yml`), or `.pritty.json` (or
`.prittyrc.yaml`, `pritty.config.json`, etc.), at your repo root (found
from any subdirectory; a nearer one wins). Both may sit in one folder
while a team moves to `.helmsmith/` (an older pritty reads only
`.pritty.json`), as long as they hold the same config: pritty refuses to
run when they differ. `pritty init` writes `.helmsmith/pritty.json` when
the repo has a `.helmsmith` folder.

```json
{
  "provider": "anthropic",
  "baseBranch": "develop",
  "commitStyle": "conventional",
  "commitGrouping": "change",
  "commitLabels": false,
  "github": { "account": "my-gh-login" },
  "commitTrailers": ["Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"],
  "prFooter": "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  "aiTimeoutMs": 60000,
  "categories": {
    "test": ["**/*.test.*", "**/*.spec.*"],
    "app": ["src/**", "lib/**"],
    "infra": ["terraform/**", ".github/**"]
  }
}
```

`commitLabels` (default `false`) makes every commit subject start with a
label, `<LABEL> <type>(<scope>): <description>`, for the `conventional` and
`angular` styles; `--label` is refused under `gitmoji` and `simple`. An
explicit label (`--label`, or `label` in a JSON body) is used whatever the
setting; with `commitLabels` on, the args and JSON inputs require one and the
interactive flow adds one (see [Agent commits](#agent-commits-and-labels)).

**Tip on category ordering**: pritty uses *first-match-wins*, so put
specific categories (like `test`) before broad ones (like `app`)
when a file could match both — otherwise `src/foo.test.ts` lands in
`app` rather than `test`.

## Auth

Pritty's auth layer is a thin wrapper around `@helmsmith/agent-auth`:

- `pritty auth login` runs GitHub OAuth Device Flow with the public
  Copilot client ID. The token is persisted to `~/.pritty/auth.json`
  with mode 0600.
- `pritty auth status` reads the stored credentials and shows
  per-provider info (no token values are ever printed).
- `pritty auth logout` removes the file.

Override the storage path with `PRITTY_HOME=<dir>`. The same primitive
backs gittyup, future Helmsmith CLIs, etc. — change auth in one place,
every consumer inherits the change.

## AI providers

Default is **Claude Code**: pritty runs the `claude` binary on PATH
headlessly, on that binary's own login (a claude.ai subscription
works). Pick a different primary or set up a fallback chain in
`.pritty.json`:

```jsonc
{
  "provider": "claude",                     // default; or "copilot" / "anthropic" / "openai"
  "fallback": [],                           // empty by default — opt in here
  "anthropicKeyEnv": "ANTHROPIC_API_KEY",   // env var to read the key from
  "openaiKeyEnv": "OPENAI_API_KEY"          // (these are also the defaults)
}
```

Choosing a non-Copilot provider:

```jsonc
{ "provider": "anthropic" }    // requires ANTHROPIC_API_KEY in env
{ "provider": "openai" }       // requires OPENAI_API_KEY in env
```

Fallback chain — try primary, then walk `fallback` in order until one
is configured. This is opt-in (default `fallback: []` means "primary
or nothing"):

```jsonc
{
  "provider": "copilot",
  "fallback": ["anthropic", "openai"]
}
```

When nothing is configured pritty fails with a clear error naming
every provider tried and how to set each one up. Provider choice is
explicit — pritty doesn't auto-detect based on which env vars happen
to be present.

## Stack

Per [helmsmith stack conventions](../../README.md):

- TypeScript ESM
- Commander.js for CLI parsing
- vitest for tests
- tsup for bundling
- chalk for colored output
- Zod for config validation
- minimatch for glob category matching

## Development

```bash
# from toolbox root:
npm install
npm test --workspace=@helmsmith/pritty
npm run build --workspace=@helmsmith/pritty

# from this directory:
npm test
npm run dev -- categorize --all   # tsx-driven dev mode
```

## Base branch

`--base <branch>` wins; otherwise `baseBranch` from `.pritty.json`; otherwise
the repository's default branch as GitHub reports it; otherwise `main`. An
explicit `baseBranch` is never overridden. `pr` and `rebase` compare against
`origin/<base>` when the remote has it, so a stale local base branch (common
in worktrees) does not change the commit list.

## GitHub identity

The token for the GitHub API is resolved in this order: `GH_TOKEN`,
`GITHUB_TOKEN`, `gh auth token --user <github.account>` when `.pritty.json`
names an account, `gh auth token`, and only then the Copilot device-flow token
from `pritty auth login` (its `read:user` scope cannot open pull requests, so
pritty warns when it has to use it). Pushing uses git's own credentials.

## Unattended use

```bash
pritty pr --json --base develop --draft --no-push \
  --title "feat(area): what changed" --body-file /tmp/pr-body.md
```

`--json` (`--output=json`) prints one line
`{ number, url, created, draft, head, base, title, labels }` on stdout and everything else on stderr, implies `--auto-approve`, and requires
`--base` or a configured `baseBranch`. `--title` with `--body`/`--body-file`
uses your words: no model call, no ticket flow; a label every commit shares,
and its tags, are added to the title when missing (see
[Agent commits and labels](#agent-commits-and-labels)); labels come from
conventional commit types. An open PR for the same head and base is returned
(`created: false`) and, when a title or body was given, updated in place;
`--dry-run` never updates it, and prints what it would set instead.
`--no-push` is for callers that already pushed with upstream tracking.
Every prompt fails with instructions when stdin is not a terminal.

Every command takes `--output=json`, with `--json` as its shorthand
(`--output=text`, the default, is for people; any other value is refused). stdout then carries exactly one JSON line, the
result; every human line moves to stderr. A failure prints no JSON: a message
on stderr and exit code 1.

| Command | JSON line |
|---|---|
| `commit` | `{ dryRun, commits: [{ change?, category, message, label?, type, scope, breaking?, description, body?, files, sha? }], reusedPlan? }`; `message` is the labelled first line as committed; `breaking` is present (`true`) only for a `!` subject; `sha` is absent on a dry run (implies `--auto-approve`) |
| `pr` | `{ number, url, created, draft, head, base, title, labels }` (implies `--auto-approve`, needs a base); `--dry-run`: `{ dryRun, title, body?, labels, draft, head, base }`, the PR it would open or what it would set on the open one (`body` absent only when that PR keeps its own) |
| `pr --check` | `{ open, last }` |
| `rebase` | `{ dryRun, branch, base, strategy, commits: [{ hash, subject }], steps: [{ hash, action, message?, rationale? }], summary, rebased }`; commits oldest first; `steps: []` and `summary: null` when fewer than two commits |
| `categorize` | `{ all, categories: [{ category, files }] }` (empty categories left out) |
| `init` | `{ written, skipped, gitRepo }` (absolute paths; implies `--no-aliases`) |
| `auth login` | `{ provider, scope, path }` (the device-flow URL and code go to stderr) |
| `auth status` | `{ providers: [{ id, scope, createdAt, expiresAt }] }` (never the token) |
| `auth logout` | `{ path, removed }` |
| `cache path` | `{ path }` |
| `cache clear` | `{ path, removed }` |

`--json` approves nothing on `rebase`: without `--dry-run` it still asks
before rewriting history, so without a terminal it fails before calling the
model. `rebase --dry-run --json` is the unattended form.

`pritty commit` commits only the index content of each category's files
(never the working tree) and appends `commitTrailers`; `pritty pr` appends
`prFooter` to every body, once (a body that already ends with it keeps one
copy; `--no-footer` leaves it out). The diff sent to the model is redacted
(secret files omitted, keys and tokens masked) and every model call is
bounded by `aiTimeoutMs`.

`pritty commit` groups staged files **by change, then by category**. The
categorizer labels every file by glob first, with no model involved; the same
model call that writes the messages then says which files form each change,
and pritty makes one commit per change per category:

```
staged: auth/login.ts, auth/login.test.ts, billing/invoice.ts, billing/invoice.test.ts

login rate limit   app   feat(auth): rate-limit login
                   test  test(auth): cover the rate limit
invoice rounding   app   fix(billing): round invoice totals
                   test  test(billing): cover rounding
```

A category the model leaves whole commits all of its staged files, whatever
file list the model returned; but a commit labelled with a change that names
some of its category's files and not the rest is refused, since a file was left
out of every change. A category the model splits takes each commit's files
from the model, and the whole plan is refused, before any commit, when the
split is not exact: a commit with no change label or no files, a file that is
not one of that category's staged files (a misspelled path included), a file
in two commits, two commits with the same label, or a staged file in none.
The plan shows each change with its commits and their files, so the grouping
is reviewed before anything is committed. Whole files only: a file holding
parts of two changes goes with one of them.
`"commitGrouping": "category"` (default `"change"`) restores one commit per
category.

`pritty commit` details that make its output reviewable:
- **The dry run is what gets committed.** A run keeps the plan it showed in
  `<git dir>/pritty/commit-plan.json`, keyed by HEAD, the staged tree
  (`git write-tree`), the branch, the categories, the grouping and the commit style. The
  next real run with the same key commits that plan without asking the model
  again (`"reusedPlan": true` under `--json`); a successful run deletes it, a
  refused commit keeps it for the retry. A dry run always asks the model, so
  a fresh draft is one `--dry-run` away.
- **Order is fixed, except the order of changes:** change by change, in the
  order the model first named each change; inside a change, code categories
  first (in category order), then `test`, then `storybook`. Commits the model
  gave no change go first (code) or last (tests and stories), so a plan with
  no changes keeps the plain code → test → storybook order. Within a change no
  commit is red against its own tests; across changes the order is the
  model's.
- **The branch types fixes.** The model is told the branch name. On a
  `fix/…` (also `bugfix/`, `hotfix/`) branch, a code commit the model typed
  `feat`, `build` or `chore` becomes `fix`; `test` and `storybook` commits,
  docs, refactors and the rest keep their type.
- **What the caller knows wins.** `--type <type>` sets the code commits' type
  (test and storybook commits keep theirs), over the model and the branch
  rule. `--scope <path>` sets every commit's scope, one to three lowercase
  segments: `network`, `org/global`, `org/network/directory`. `--trailer
  "Token: value"` (repeatable) adds a trailer to every commit after
  `commitTrailers`, such as `Refs: plan-5 T9` to tie a task's commits
  together for `git log --grep`. All three are checked before the model is
  asked; a subject the model wrote that is not conventional is kept as
  written, with a note.
- **A renamed category is paired, once.** If the model returns exactly one
  category name the categorizer did not produce (it once sent `unknown`
  back as `feature`) and exactly one category with staged files is
  unclaimed, the two are paired and the run says so. Anything less certain
  is still refused before a commit is made.
- **`--no-verify`** passes `--no-verify` to `git commit`, for when a hook
  refuses and bypassing it was approved.

The model drafting a PR sees each commit's subject and body (without the
Co-Authored-By and Commit-Message-By lines of its closing trailer block) plus the files the
branch changed, capped at 12,000 characters like the commit diff: every subject
stays, long bodies share the room evenly, and the file list is cut first. It is
told to take the why from the bodies rather than invent one. `pritty pr` opens a
drafted title with the commits' conventional prefix: the
branch's type when a commit carries it, else the most significant commit type
(feat, fix, perf, refactor, revert, build, ci, docs, style, test, chore), with
the scope that type's commits share. A `--title` keeps its words: only a label
every commit shares, and its tags, are added when missing (see
[Agent commits and labels](#agent-commits-and-labels)).

## Agent commits and labels

`pritty commit` takes its commits from one of three inputs; args and JSON make
no model call and combining them is refused.

| Input | Selected by | Model call |
|---|---|---|
| Args | `--message`, with `--type` and `--scope` (and `--label`) | no |
| JSON body | `--input=json`, the commits on stdin | no |
| Interactive | neither | yes |

**Args.** One commit per call:

```bash
pritty commit --label STATUS-LOGGING --type fix --scope issue-report \
  --message "log only exception class when status apply fails" \
  [--body <text>] [--breaking] [--trailer "Token: value"] [--no-verify] \
  [--dry-run] --output=json -- src/StatusConsumer.java
```

`--type` and `--scope` are required; `--label` is required where
`commitLabels` is `true` and used when given elsewhere; `--breaking` marks a
breaking change, `!` after the scope (`fix(api)!: …`). The description
(`--message`) is one line with no space before or after it, a lower-case
first word and no trailing period; more lines go in `--body`. The paths after `--`
resolve from the current directory like `git add`, must each be staged and
are the only files committed; with none, every staged file. Paths after `--`
without `--message` are refused. All the files must share one category (code
and tests go in separate commits, code first); a `test` or `storybook`
category needs `--type test`, a code category must not use it. Problems are
reported together before anything is committed.

**JSON body.** One or more commits on stdin; `files` are
repository-root-relative, as `--output=json` prints them:

```bash
echo '{"commits":[
  {"label":"WEDMODD-23444","type":"fix","scope":"issue-report","description":"log only exception class","files":["src/StatusConsumer.java"]},
  {"label":"WEDMODD-23444","type":"test","scope":"issue-report","description":"assert no exception text is logged","body":"why","files":["src/StatusConsumerTest.java"]}
]}' | pritty commit --input=json --output=json
```

`body` and `files` are optional (`files` may be left out only for a single
commit, which then takes every staged file); `label` is optional unless
`commitLabels` is `true`; `"breaking": true` puts `!` after the scope. Each commit gets the args checks, plus: a file is
staged and in one commit only. Commits are made label by label in order of
first appearance, code, then tests, then stories. `--input=json` runs
unattended (no confirmation prompt) and refuses `--label`, `--type`, `--scope`,
`--message`, `--body`, `--breaking` and paths after `--`; `--trailer`, `--no-verify`,
`--dry-run` and `--output`/`--json` stay allowed. Staged files no commit lists
stay staged. If git refuses a commit midway (a hook), pritty stops and the
error names the refused commit and the shas already made.

**Output and dry run.** `--output=json` prints the result: each commit has
`category`, `message` (the labelled first line as committed), `label`, `type`,
`scope`, `breaking` (when true), `description`, `body` (when present), `files`
and `sha`. `--dry-run`
validates and prints the same JSON without `sha`, touching nothing, and that
output can be fed straight back through `--input=json`. A subject over 72
characters warns on stderr; it is never refused. The args and JSON inputs
check format only: no ticket detection or lookup.

**Labels.** A label is trimmed, upper-cased, and each run of whitespace
becomes one `-` (`status logging` is `STATUS-LOGGING`, `wedmodd-23444` is
`WEDMODD-23444`); the result must match `[A-Z0-9]+(-[A-Z0-9]+)*`, and `/`,
`_`, `--` and punctuation are refused rather than converted. Labels need the
`conventional` or `angular` commit style. pritty never rewrites the type,
scope or description it is given; it normalises the label and adds trailers.

**Interactive labels** (only where `commitLabels` is `true`): an explicit
`--label`, else the ticket detected (repositories with a `ticket` block), else
an attended prompt (`Enter` takes the model's names), else the model's change
names, normalised. With `commitGrouping: "category"` the model gives one label
for the run.

**Pull requests** take the same three inputs: args (`--title`, with `--body`
or `--body-file`), a JSON body (`--input=json`) of
`{ "title", "body"?, "draft"?, "labels"? }`, or interactive. The JSON title is
treated like `--title` and the body like `--body` (`prFooter` appended unless
`--no-footer`); `labels` replace the labels inferred from commit types; output
fields (`number`, `url`, `dryRun`, …) are ignored, so a dry run's output can be
fed back. `--input=json` runs unattended and is refused together with
`--title`, `--body` or `--body-file`; `--check`, `--no-push`, `--no-footer`,
`--draft` and `--base` work with every input. `--dry-run` pushes, creates and
edits nothing, an open PR included.

When every non-merge commit between base and HEAD carries the same label, the
PR title is `LABEL: summary [types] [scopes]`: the model's summary, then each
commit type once (most significant first), then each scope once in order of
first use: `WEDMODD-23444: stop status apply logging exception text [fix] [test] [issue-report]`.
Otherwise the title is `type(scope): summary` as before. A `--title` or JSON
title gets the label and tags added when missing. This depends on the commits,
not on `commitLabels`. Where PRs are squash-merged, that title becomes the
commit subject and is not conventional; merge-commit repositories are
unaffected.

## Agent files

`pritty init` also installs two files for coding agents (skip them with
`--no-agent` and `--no-agents-md`; `--no-claude` does not affect them):

- `.claude/agents/pritty.md`, a Claude Code subagent named `pritty`. Ask for it
  by name ("use the pritty agent to commit this") or `@agent-pritty`; Claude
  Code also picks it up when work is done. Tell it what the change was for, and
  the ticket. It reads git, stages with `git add -- <paths>`, previews and
  commits with `pritty commit`, and opens PRs with `pritty pr --input=json`.
  An existing file is kept unless `--force`.
- A section of `AGENTS.md` between `<!-- pritty:begin ... -->` and
  `<!-- pritty:end -->`, rewritten on every `init`; the rest of the file is
  untouched, and the file is created when missing. Claude Code reads
  `AGENTS.md` only when the repository has no `CLAUDE.md`; with one, `init`
  prints a hint to add `@AGENTS.md` and never edits `CLAUDE.md`.

The subagent's `PreToolUse` hook runs the hidden `pritty agent-guard`. It allows
only read-only `git status|diff|log|show|rev-parse|ls-files`,
`git add -- <paths>` and `pritty commit|pr|categorize` with a flag allowlist
per command, written as plain words and simple double-quoted text, and
Write/Edit only inside the scratch directory
(`git rev-parse --path-format=absolute --git-path pritty`). It refuses
`--no-verify`, `--trailer`, `--body-file`, flag values starting with `-` and
every shell operator, `$` and other quote; text it will not pass as an
argument goes through `--input=json`. Claude Code runs a project agent's hooks
only after you accept the workspace trust prompt. When `init` finds broken
markers in `AGENTS.md`, or either file is a symlink or not a regular file, it
leaves the file alone and lists it as skipped, with the reason.

## Programmatic use

`@helmsmith/pritty` exports the whole surface; `@helmsmith/pritty/core`
exports only the deterministic pieces (git, GitHub, token resolution, PR
template, CODEOWNERS, config, attribution, redaction) and loads without the
AI adapters, OpenTUI or inquirer.

## Providers

`provider` is one of:

- `claude` (default): runs the `claude` binary on PATH headlessly (`claude -p`, one turn, no tools, no MCP servers (see [Claude Code under an enterprise policy](#claude-code-under-an-enterprise-policy)), no session on disk, user settings only, from the temp directory rather than the repository, so a cloned repository's hooks, settings, CLAUDE.md and `.mcp.json` never apply) on whatever login that binary has. A claude.ai subscription works; no API key passes through pritty. Install Claude Code and run `claude` once to log in.
- `copilot`: `pritty auth login` runs the GitHub device flow.
- `anthropic`: the Anthropic API with the key from `ANTHROPIC_API_KEY` (or the variable named by `anthropicKeyEnv`).
- `openai`: `OPENAI_API_KEY` / `openaiKeyEnv`.

`model` is optional and defaults per provider: `claude-opus-5-5` for `claude`, `anthropic` and `copilot`, `gpt-6-astra` for `openai`. `fallback` lists providers to try when the primary is not configured on the machine.

A repository needs no `provider` key to use Claude on the team's subscriptions. To keep GitHub Copilot, set `{ "provider": "copilot" }`; to bill an API key instead, set `{ "provider": "anthropic" }` and export `ANTHROPIC_API_KEY` in the shell that runs `pritty` (or `work pr`).

### Claude Code under an enterprise policy

By default the `claude` provider runs `claude` with `--strict-mcp-config` and an empty `--mcp-config`, so no MCP server loads. Some enterprise environments deploy a managed Claude Code policy that refuses those flags, and every call pritty makes to `claude` then fails. Turn the MCP lockdown off for those environments:

```jsonc
{ "claude": { "strictMcpConfig": false } }   // default true
```

What changes when it is `false`:

- pritty passes neither `--strict-mcp-config` nor `--mcp-config`. Without the strict flag, an empty `--mcp-config` adds nothing, so both are dropped.
- The MCP servers from your user settings and from the managed policy load as usual.
- Nothing else changes. `claude` still runs one turn with none of its built-in tools and user settings only, from the temp directory. The repository's `.mcp.json`, hooks, settings and CLAUDE.md still never apply.

The setting lives in the repository's pritty config. pritty has no per-user config file, so it applies to everyone who runs pritty in that repository, including people on machines without a managed policy. On those machines, the MCP servers in their own user settings start with each call, and the model is offered their tools: `--tools ''` turns off only Claude Code's built-in tools. A tool that someone's settings already allow could run within the one turn, with the staged diff as the model's input. Set the key only in repositories whose contributors you trust.
