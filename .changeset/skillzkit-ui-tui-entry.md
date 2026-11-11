---
"@helmsmith/skillzkit": patch
---

`skillzkit ui` starts the interactive installer again. It looked for the TUI at `tui/main.tsx` in the package, which stopped existing when the TUI moved to `src/tui/` (and no `tui/` directory was ever shipped), so it exited with `TUI entry not found`. The TUI is now built into `dist/tui.js` alongside the CLI. The Bun process that runs it also no longer reads `.env` or `bunfig.toml` from the directory you run `skillzkit ui` in: a `bunfig.toml` `preload` there would have run its code. It now starts the way `bin/skillzkit.mjs` starts the CLI, with `--no-env-file` and the package's own empty `bunfig.toml`.
