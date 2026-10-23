# @helmsmith/pritty

## 0.3.2

### Patch Changes

- fbf2816: `pritty --version` reports the installed version again — 0.3.1 printed `0.3.0` because the version was a literal in `src/cli.ts`. It is now read from package.json at runtime, like storybrokr and workbrokr.

## 0.3.1

### Patch Changes

- Dependency upgrades, including a security fix:
  
  - `simple-git` ^3.36 → ^4.0.2, closing critical advisories in simple-git < 4.0.1. simple-git 4 removes inherited `GIT_*` variables from the git processes it starts, so the commit and push pritty runs through it no longer see an ambient `GIT_SSH_COMMAND` or `GIT_AUTHOR_*`/`GIT_COMMITTER_*`; SSH agents and identity/credentials from git config are unaffected.
  - `@anthropic-ai/sdk` ^0.137.0, `openai` ^7.43.0, `@inquirer/prompts` ^8.7.4, `js-yaml` ^5.5.0, `zod` ^4.6.7, `chalk` ^6.0.1.

## 0.3.0

### Minor Changes

- New provider `claude`: pritty runs the Claude Code binary on PATH headlessly (`claude -p`, one turn, no tools, no MCP servers, no session on disk, skills off, user settings only, from the temp directory so the repository's hooks, settings, CLAUDE.md and `.mcp.json` never load) on its own login, so a claude.ai subscription drafts commit messages and PR text without an API key. Works from inside a Claude Code session. Default model `claude-opus-5-5`. When `claude` is not on PATH the provider counts as unconfigured and the error says how to install and log in.

## 0.2.2

### Patch Changes

- The skill text that `pritty init` installs shows the current default model in its config example instead of `gpt-4o`; a test now ties that example to the provider default table.

## 0.2.1

### Patch Changes

- The model default follows the provider: `claude-opus-5-5` for `anthropic` and `copilot` (Copilot serves Claude through its models API), `gpt-6-astra` for `openai`. `provider: "anthropic"` without a `model` no longer sends a GPT model name to Anthropic; an explicit `model` still wins. The starter config sets the provider instead of a model.

## 0.2.0

### Minor Changes

- `pritty connect` is removed. The view only showed the GitHub Copilot login and offered login and logout, which `pritty auth status`, `pritty auth login` and `pritty auth logout` already do; it was also the sole reason the package depended on Bun, OpenTUI and React. Those dependencies are gone, the bin no longer re-execs anything, and every command runs under plain Node.

## 0.1.2

### Patch Changes

- `pritty pr --check` reports what became of the last PR when none is open: `{ open: null, last: { number, url, state: "MERGED" | "CLOSED" } }`, so `work pr` can say which.
- `pritty commit --json`: one JSON line `{ dryRun, commits: [{ category, message, files, sha }] }` on stdout, everything else on stderr; implies `--auto-approve`.

## 0.1.1

### Patch Changes

- `pritty pr --check`: print the open PR for this head and base as one JSON line `{ open }` (or `{ open: null }`) and push, generate and create nothing. workbrokr's `work pr` uses it to learn that a stored PR was closed without creating another.

## 0.1.0

### Minor Changes

- First published release. `pritty commit` (per-category AI commit messages, index-only commits, `commitTrailers`), `pritty pr` (AI or given title/body, `--draft`, `--json`, `--no-push`, existing-PR reuse and in-place update, `prFooter`, CODEOWNERS reviewers, labels), `pritty rebase` (AI-planned; a last resort — prefer a merge commit). Repository files (`.pritty.json`, PR template, CODEOWNERS) are found from any subdirectory. GitHub identity per repository (`GH_TOKEN`, `GITHUB_TOKEN`, `gh auth token --user <github.account>`, `gh auth token`, then the Copilot token). The diff sent to the model is redacted and every model call is bounded by `aiTimeoutMs`. `@helmsmith/pritty/core` exports the deterministic pieces without the AI adapters or the TUI.

### Patch Changes

- The twelve defects of the 2026-10-18 tooling review (helmsmith `docs/superpowers/specs/2026-10-18-work-tooling-review.md` §5.1a), each fixed with a test that failed first.
