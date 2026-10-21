---
"@helmsmith/gittyup": patch
---

CLI robustness (round-2 review):

- `merge` and `pick` no longer hang or silently proceed without a terminal: the plan confirmation is gated so a non-interactive run (CI, a pipe) exits non-zero with a message to pass `--yes`, and `--yes` now also skips that plan confirmation (C1).
- `repo add <path>` and `find` store the repo's absolute path (resolved where the command runs), and `init` sets the manifest workspace to the working directory rather than the config folder. The documented quick start (`init`, then `repo add ./x` or `find`) now registers repos that actually resolve, instead of every row showing "Repo path not found" (C3).
