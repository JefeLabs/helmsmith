# @helmsmith/pritty

## 0.5.0

### Minor Changes

- 2834982: Fixes from a one-week trial in which pritty drafted every commit and PR in another repository.
  
  - `pritty commit` commits what its dry run showed. The plan is kept in `<git dir>/pritty/commit-plan.json`, keyed by HEAD, the staged tree, the branch, the categories and the commit style. The next real run with the same key commits it without a second model call (`"reusedPlan": true` under `--json`). A refused commit keeps it for the retry. A dry run always drafts afresh. Before this, the real run asked the model again, so subjects and bodies changed after review; one dropped a `Refs #…` line.
  - Commit order no longer comes from the model. Code categories go first, then `test`, then `storybook`. Three real runs had committed tests or stories before the code they need, so the first commit failed its own tests.
  - The model is told the branch name. On a `fix/…` branch, a code commit typed `feat`, `build` or `chore` becomes `fix`. Test, story, docs and refactor commits keep their type. Bug fixes had been typed `feat`, `build` or `chore` at least six times.
  - `pritty commit --no-verify` passes `--no-verify` to `git commit` for an approved hook bypass.
  - A one-category plan the model returns as a bare object, not an array, is accepted. It used to fail with "AI returned non-array output".
  - `pritty pr` opens a drafted title with the commits' `type(scope):` prefix. A `--title` is still used verbatim.
  - `pritty pr --no-footer` leaves `prFooter` out. A `prFooter` of several lines no longer gets a second copy when the body already ends with it.
  - The PR prompt asks for a plain-bullet test plan instead of a checklist of unchecked boxes.
  - The model drafting a PR now sees each commit's body and the changed files, and is told to take the why from the bodies. The closing trailer block loses its Co-Authored-By and Commit-Message-By lines; Signed-off-by, Refs and the rest stay. Input stays under the commit diff's 12,000-character cap: every subject is kept, long bodies share the room evenly, and the file list is cut first. It used to see only subjects, so every trial PR body made up its why.

## 0.4.0

### Minor Changes

- d6dca7a: Every command takes `--json`: `rebase`, `categorize`, `init`, `auth login`, `auth status`, `auth logout`, `cache path` and `cache clear` join `commit` and `pr`. stdout carries one JSON line, the result; everything else goes to stderr; a failure prints no JSON and exits 1. `rebase --json` still asks before rewriting history, so use `rebase --dry-run --json` unattended. `init --json` implies `--no-aliases`. `auth status --json` never includes the token.
  
  `pritty rebase` without `--dry-run` and without a terminal now fails before calling the model, and names `--dry-run`, instead of failing at the confirmation with advice to pass `--auto-approve`, a flag rebase does not have. `auth logout` and `cache clear` say when there was nothing to remove; `clearCache()` now returns whether it removed a file.

## 0.3.4

### Patch Changes

- 413b722: `pritty commit` works from a subdirectory of the repository. It used to fail with `nothing staged for src/…` and commit nothing, because git ran in the current directory, where pathspecs are relative to that directory while `git diff` reports paths from the repository root. pritty now runs git from the repository root. This also fixes `pritty categorize --all` from a subdirectory, which missed untracked files outside it and filed the ones inside it under `unknown`.

## 0.3.3

### Patch Changes

- f6f478f: `GIT_SSH_COMMAND` from your environment reaches git again when pritty pushes. 0.3.1's move to simple-git 4 stripped every inherited `GIT_*` variable, so a `GIT_SSH_COMMAND` that picks a key, a ProxyJump or other ssh options was silently ignored by `pritty`'s push. It is now allow-listed; every other guarded variable (`GIT_SSH`, `GIT_ASKPASS`, `GIT_CONFIG_*`, `GIT_AUTHOR_*`, `PAGER`, …) is still stripped. Same change as gittyup 0.3.1.

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
