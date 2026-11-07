---
"@helmsmith/gittyup": minor
---

Every command a program would call now takes `--json`: `status`, `compare`, `prs`, `fetch`, `find`, `repo list|tags|tag|add|remove`, `group create|remove`, `config`, `auth status|models` and `cache clear|prune`. Each prints exactly one JSON line on stdout and never prompts. A refusal prints an empty stdout, a `{ code, message, details? }` line on stderr and exits 2; a breakage exits 1. See "Scripting with `--json`" in the README. `merge` and `pick` follow in a later release.

### JSON contract

- New in this release. While gittyup is 0.x, shapes may change when a hardening slice lands; each such change will be listed here.
- Text mode: `status` now shows `–` instead of `0` for ahead/behind when a branch has no tracking ref, because "0" read as "in sync" for a branch that was never pushed.
