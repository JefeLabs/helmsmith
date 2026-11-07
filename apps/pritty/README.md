# 🎀 @helmsmith/pritty

> Where pritty sits in a feature's life (`work pr` pushes first, then pritty opens the PR with the repository's conventions): [The life of a worktree](https://github.com/JefeLabs/helmsmith/blob/main/docs/work-lifecycle.md).

**Pretty PRs, zero effort.** AI-powered CLI that categorizes staged
files by purpose, generates conventional commits, and creates pull
requests — with pluggable hooks and human-in-the-loop approval.

Part of the [agentx-toolbox](../..) monorepo. Auth + multi-agent
adapters live in shared packages (`@helmsmith/agent-auth`,
`@helmsmith/agent-adapter`) so pritty doesn't reinvent OAuth or LLM
provider routing.

## Status

This is a **phased build** following the
[implementation plan](../../../agentx-pritty/pritty-implementation-plan.md).

| Phase | Status |
|---|---|
| Auth (login / logout / status via `@helmsmith/agent-auth`) | ✅ |
| Config (.pritty.json + Zod schema) | ✅ |
| Categorizer (default + custom glob categories) | ✅ |
| `pritty init` starter config | ✅ |
| `pritty categorize` (read-only file bucketing) | ✅ |
| AI client (multi-provider via `@helmsmith/agent-adapter`) | ✅ |
| `pritty commit` (per-category AI commit messages, index-only commits) | ✅ |
| `pritty pr` (AI-generated PR title + body, existing-PR reuse) | ✅ |
| `pritty rebase` (AI-planned rebase; a last resort — prefer a merge commit) | ✅ |
| Pre-commit / pre-push hook runner | removed — git hooks belong to the repository |
| Outlier detection + interactive resolution | ⏳ |

## Quick start

```bash
pritty                                # shows command list (Commander default)
pritty auth login                     # GitHub Device Flow → ~/.pritty/auth.json
pritty auth status
pritty init                           # write .pritty.json with sane defaults
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

`.pritty.json` (or `.prittyrc.yaml`, `pritty.config.json`, etc.) at
your repo root (found from any subdirectory; a nearer one wins):

```json
{
  "provider": "anthropic",
  "baseBranch": "develop",
  "commitStyle": "conventional",
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
backs gittyup, future AgentX CLIs, etc. — change auth in one place,
every consumer inherits the change.

## AI providers

Default is **GitHub Copilot** via the device-flow login at
`~/.pritty/auth.json`. Pick a different primary or set up a fallback
chain in `.pritty.json`:

```jsonc
{
  "provider": "copilot",                    // default; or "anthropic" / "openai"
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

Per [agentx-toolbox stack conventions](../../README.md):

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

`--json` prints one line `{ number, url, created, draft, head, base }` on
stdout and everything else on stderr, implies `--auto-approve`, and requires
`--base` or a configured `baseBranch`. `--title` with `--body`/`--body-file`
uses the words verbatim: no model call, no ticket flow; labels come from
conventional commit types. An open PR for the same head and base is returned
(`created: false`) and, when a title or body was given, updated in place.
`--no-push` is for callers that already pushed with upstream tracking.
Every prompt fails with instructions when stdin is not a terminal.

`pritty commit` commits only the index content of each category's files
(never the working tree) and appends `commitTrailers`; `pritty pr` appends
`prFooter` to every body, once (a body that already ends with it keeps one
copy; `--no-footer` leaves it out). The diff sent to the model is redacted
(secret files omitted, keys and tokens masked) and every model call is
bounded by `aiTimeoutMs`.

`pritty commit` details that make its output reviewable:
- **The dry run is what gets committed.** A run keeps the plan it showed in
  `<git dir>/pritty/commit-plan.json`, keyed by HEAD, the staged tree
  (`git write-tree`), the branch, the categories and the commit style. The
  next real run with the same key commits that plan without asking the model
  again (`"reusedPlan": true` under `--json`); a successful run deletes it, a
  refused commit keeps it for the retry. A dry run always asks the model, so
  a fresh draft is one `--dry-run` away.
- **Order is fixed:** code categories first (in category order), then
  `test`, then `storybook`, whatever order the model answered in, so no commit
  is red against its own tests.
- **The branch types fixes.** The model is told the branch name. On a
  `fix/…` (also `bugfix/`, `hotfix/`) branch, a code commit the model typed
  `feat`, `build` or `chore` becomes `fix`; `test` and `storybook` commits,
  docs, refactors and the rest keep their type.
- **`--no-verify`** passes `--no-verify` to `git commit`, for when a hook
  refuses and bypassing it was approved.

The model drafting a PR sees each commit's subject and body (without the
Co-Authored-By, Commit-Message-By and Signed-off-by trailers) plus the files the
branch changed, capped at 12,000 characters like the commit diff: every subject
stays, long bodies share the room evenly, and the file list is cut first. It is
told to take the why from the bodies rather than invent one. `pritty pr` opens a
drafted title with the commits' conventional prefix: the
branch's type when a commit carries it, else the most significant commit type
(feat, fix, perf, refactor, revert, build, ci, docs, style, test, chore), with
the scope that type's commits share. A `--title` is always used verbatim.

## Programmatic use

`@helmsmith/pritty` exports the whole surface; `@helmsmith/pritty/core`
exports only the deterministic pieces (git, GitHub, token resolution, PR
template, CODEOWNERS, config, attribution, redaction) and loads without the
AI adapters, OpenTUI or inquirer.

## Providers

`provider` is one of:

- `copilot` (default): `pritty auth login` runs the GitHub device flow.
- `claude`: runs the `claude` binary on PATH headlessly (`claude -p`, one turn, no tools, no MCP servers, no session on disk, user settings only, from the temp directory rather than the repository, so a cloned repository's hooks, settings, CLAUDE.md and `.mcp.json` never apply) on whatever login that binary has. A claude.ai subscription works; no API key passes through pritty. Install Claude Code and run `claude` once to log in.
- `anthropic`: the Anthropic API with the key from `ANTHROPIC_API_KEY` (or the variable named by `anthropicKeyEnv`).
- `openai`: `OPENAI_API_KEY` / `openaiKeyEnv`.

`model` is optional and defaults per provider: `claude-opus-5-5` for `claude`, `anthropic` and `copilot`, `gpt-6-astra` for `openai`. `fallback` lists providers to try when the primary is not configured on the machine.

To use Claude on the team's subscriptions by default in a repository:

```json
{ "provider": "claude" }
```

or `{ "provider": "anthropic" }` with `ANTHROPIC_API_KEY` exported in the shell that runs `pritty` (or `work pr`) to bill an API key instead.
