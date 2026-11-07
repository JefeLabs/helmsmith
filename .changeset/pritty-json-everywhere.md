---
"@helmsmith/pritty": minor
---

Every command takes `--json`: `rebase`, `categorize`, `init`, `auth login`, `auth status`, `auth logout`, `cache path` and `cache clear` join `commit` and `pr`. stdout carries one JSON line, the result; everything else goes to stderr; a failure prints no JSON and exits 1. `rebase --json` still asks before rewriting history, so use `rebase --dry-run --json` unattended. `init --json` implies `--no-aliases`. `auth status --json` never includes the token.

`pritty rebase` without `--dry-run` and without a terminal now fails before calling the model, and names `--dry-run`, instead of failing at the confirmation with advice to pass `--auto-approve`, a flag rebase does not have. `auth logout` and `cache clear` say when there was nothing to remove; `clearCache()` now returns whether it removed a file.
