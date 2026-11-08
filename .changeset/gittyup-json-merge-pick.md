---
"@helmsmith/gittyup": minor
---

`merge` and `pick` take `--json` (with `--yes`). They never prompt: on a conflict gittyup's own agent tries to resolve every file, and if any file can't be resolved the repo is rolled back to exactly where it started. Each run prints one JSON report: per repo the status, which files the agent resolved, whether it rolled back, the target's final commit, and whether it pushed. Commits the agent resolved carry a `Resolved-by: gittyup agent (<model>)` trailer. A manifest set to `ai_mode: manual` keeps the agent out.

### JSON contract

- `--pr` under `--json` reports `skipped` ("needs --branch") for every repo until hardening §3.5 adds `--branch`; it will then report `created`/`existing`/`error`.
- `agent.available` is `null` when the mode is `manual` (nothing was checked).
