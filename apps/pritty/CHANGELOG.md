# @helmsmith/pritty

## 0.2.0

### Minor Changes

- The connections view moved to `@helmsmith/pritty-connect`. `pritty connect` now delegates to that binary when it is on PATH and otherwise says how to install it. With the view gone, `@helmsmith/pritty` no longer depends on Bun, OpenTUI or React and runs under plain Node end to end; the bin no longer re-execs anything.

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
