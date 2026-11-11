# @helmsmith/mech-pencil

## 0.0.4

### Patch Changes

- 98ba4c1: Installing from npm now gets OpenTUI 0.5.10 and React 19.2.9, the versions these CLIs are built and tested with. The packages asked for `@opentui/core` and `@opentui/react` as `^0.5.10`, which on a 0.x version allows any 0.5.x, so a fresh install picked the newest one (0.5.17 as of this release). That version requires Node 26.4 or later, so `npm install` printed an `EBADENGINE` warning on Node 24, and the terminal UI ran on an OpenTUI version that was never tested here. Both are now exactly `0.5.10`. `react` was `^19.2.9` and resolved to 19.3.1; it is now exactly `19.2.9`.

## 0.0.3

### Patch Changes

- 9281bab: Security: the launcher only ever runs the Bun installed as the package's `bun` dependency. When that dependency couldn't be resolved it used to fall back to a bare `bun`, which is looked up through `PATH` (on Windows, in the current directory first), so a repo you ran the CLI in could supply its own `bun`. It now exits 1 with a reinstall message instead.
- bafaa38: `connect` (and mech-pencil's `wizard`) exits when you quit. Pressing `q` used to clear the screen and leave the process running until it was killed, because the shared TUI harness stopped openTUI's render loop instead of destroying the renderer, so the terminal and stdin were never released. The harness now destroys the renderer, and the process exits normally.
- f8888da: `connect` now shows why a login or logout failed. The error was written into the connection's status line and then immediately replaced when the view re-checked the status, so a failed login looked like nothing happened. It now stays on its own line under the actions until you start another action, and a failed logout no longer shows a still-connected account as disconnected.
- f8888da: `connect` checks each connection's status once when it opens (and again on `r` or after a login or logout), instead of thousands of times a second. An app that passed no optional connections got a new empty list on every render, so every render re-fetched every status and each fetch caused another render.
- f8888da: Interactive screens no longer burn CPU while they sit open. Every screen that binds a key (`connect`, mech-pencil's `wizard`, timetracker's summary, and any list, menu, table or confirm prompt) re-registered its key bindings in an endless loop, re-rendering hundreds of thousands of times and holding a core at 100% or more. Bindings now register once.

## 0.0.2

### Patch Changes

- a1cbe5a: Security: the Bun launcher no longer loads `bunfig.toml` or `.env*` files from the current directory. Previously, running the CLI inside a directory containing a `bunfig.toml` with a `preload` executed that script (and a `.env` there was loaded into the CLI's environment), so invoking the tool inside a cloned repo could run that repo's code. The launcher now starts Bun with `--no-env-file` and `--config=<package>/bunfig.toml`, and the package ships an empty `bunfig.toml`.
  
  timetracker still reads `./.env` itself through its config loader, as documented; `.env.local` and other `.env.*` variants that only Bun's auto-loader picked up are no longer read. Running a CLI directly under Bun (`bun x …`) bypasses the Node launcher and is not covered.
