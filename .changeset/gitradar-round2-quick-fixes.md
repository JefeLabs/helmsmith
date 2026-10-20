---
"@helmsmith/gitradar": patch
---

Security and setup fixes from the 2026-10-19 review (helmsmith #121): the launcher runs Bun with `--no-env-file` and a package-owned `bunfig.toml`, so a `.env` or `bunfig.toml` in the current directory can no longer inject environment or run preload scripts (#69); the rework pass runs `git diff` with `--no-ext-diff --no-textconv` (#69); `gitradar init` no longer crashes on a fresh machine and creates `~/.agentx` for the registry (#94); `--skip-cache` skips the GitHub cache write as well as the read, matching the batch path, and every unit-test file now runs with `HOME` and `GITRADAR_HOME` sandboxed (#74). New `tests/e2e` harness (builds `dist`, spawns `bin/gitradar` in a temp home); `test:e2e` runs it; the unit config no longer sweeps up e2e files.
