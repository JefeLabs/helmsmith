# @helmsmith/skillzkit

## 0.2.3

### Patch Changes

- 80bdd5e: `skillzkit ui` starts the interactive installer again. It looked for the TUI at `tui/main.tsx` in the package, which stopped existing when the TUI moved to `src/tui/` (and no `tui/` directory was ever shipped), so it exited with `TUI entry not found`. The TUI is now built into `dist/tui.js` alongside the CLI. The Bun process that runs it also no longer reads `.env` or `bunfig.toml` from the directory you run `skillzkit ui` in: a `bunfig.toml` `preload` there would have run its code. It now starts the way `bin/skillzkit.mjs` starts the CLI, with `--no-env-file` and the package's own empty `bunfig.toml`.
- 346c811: `taskmaster --version` and `skillzkit --version` report the package version; both printed a hard-coded `0.1.0`. The skillzkit TUI header showed the same `v0.1.0` and now shows the real version. The launchers no longer fall back to a `bun` found on PATH when the bundled Bun is missing: a bare `bun` is looked up through PATH, and on Windows in the current directory first, so a repo the CLI runs in could plant one. They now exit 1 with a reinstall message, as gittyup's, gitradar's, mech-pencil's, toolz's and timetracker's launchers already do.

## 0.2.2

### Patch Changes

- 98ba4c1: Installing from npm now gets OpenTUI 0.5.10 and React 19.2.9, the versions these CLIs are built and tested with. The packages asked for `@opentui/core` and `@opentui/react` as `^0.5.10`, which on a 0.x version allows any 0.5.x, so a fresh install picked the newest one (0.5.17 as of this release). That version requires Node 26.4 or later, so `npm install` printed an `EBADENGINE` warning on Node 24, and the terminal UI ran on an OpenTUI version that was never tested here. Both are now exactly `0.5.10`. `react` was `^19.2.9` and resolved to 19.3.1; it is now exactly `19.2.9`.

## 0.2.1

### Patch Changes

- f8888da: `connect` now shows why a login or logout failed. The error was written into the connection's status line and then immediately replaced when the view re-checked the status, so a failed login looked like nothing happened. It now stays on its own line under the actions until you start another action, and a failed logout no longer shows a still-connected account as disconnected.
- f8888da: `connect` checks each connection's status once when it opens (and again on `r` or after a login or logout), instead of thousands of times a second. An app that passed no optional connections got a new empty list on every render, so every render re-fetched every status and each fetch caused another render.
- f8888da: Interactive screens no longer burn CPU while they sit open. Every screen that binds a key (`connect`, mech-pencil's `wizard`, timetracker's summary, and any list, menu, table or confirm prompt) re-registered its key bindings in an endless loop, re-rendering hundreds of thousands of times and holding a core at 100% or more. Bindings now register once.

## 0.2.0

### Minor Changes

- df686c3: **Breaking:** `skillzkit init` writes its config to `~/.helmsmith/skillzkit/config.json` (was `~/.agentx/skillzkit/config.json`), and skillzkit no longer reads the old path. To migrate, run `mkdir -p ~/.helmsmith && mv ~/.agentx/skillzkit ~/.helmsmith/skillzkit`, or re-run `skillzkit init`.

## 0.1.1

### Patch Changes

- a1cbe5a: Security: the Bun launcher no longer loads `bunfig.toml` or `.env*` files from the current directory. Previously, running the CLI inside a directory containing a `bunfig.toml` with a `preload` executed that script (and a `.env` there was loaded into the CLI's environment), so invoking the tool inside a cloned repo could run that repo's code. The launcher now starts Bun with `--no-env-file` and `--config=<package>/bunfig.toml`, and the package ships an empty `bunfig.toml`.
  
  timetracker still reads `./.env` itself through its config loader, as documented; `.env.local` and other `.env.*` variants that only Bun's auto-loader picked up are no longer read. Running a CLI directly under Bun (`bun x …`) bypasses the Node launcher and is not covered.
