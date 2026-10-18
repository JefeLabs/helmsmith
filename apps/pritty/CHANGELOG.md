# @helmsmith/pritty

## 0.1.0

### Minor Changes

- First published release. `pritty commit` (per-category AI commit messages, index-only commits, `commitTrailers`), `pritty pr` (AI or given title/body, `--draft`, `--json`, `--no-push`, existing-PR reuse and in-place update, `prFooter`, CODEOWNERS reviewers, labels), `pritty rebase` (AI-planned; a last resort — prefer a merge commit). Repository files (`.pritty.json`, PR template, CODEOWNERS) are found from any subdirectory. GitHub identity per repository (`GH_TOKEN`, `GITHUB_TOKEN`, `gh auth token --user <github.account>`, `gh auth token`, then the Copilot token). The diff sent to the model is redacted and every model call is bounded by `aiTimeoutMs`. `@helmsmith/pritty/core` exports the deterministic pieces without the AI adapters or the TUI.

### Patch Changes

- The twelve defects of the 2026-10-18 tooling review (helmsmith `docs/superpowers/specs/2026-10-18-work-tooling-review.md` §5.1a), each fixed with a test that failed first.
