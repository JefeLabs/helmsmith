# @helmsmith/gitradar

## 0.2.2

### Patch Changes

- 98ba4c1: Installing from npm now gets OpenTUI 0.5.10 and React 19.2.9, the versions these CLIs are built and tested with. The packages asked for `@opentui/core` and `@opentui/react` as `^0.5.10`, which on a 0.x version allows any 0.5.x, so a fresh install picked the newest one (0.5.17 as of this release). That version requires Node 26.4 or later, so `npm install` printed an `EBADENGINE` warning on Node 24, and the terminal UI ran on an OpenTUI version that was never tested here. Both are now exactly `0.5.10`. `react` was `^19.2.9` and resolved to 19.3.1; it is now exactly `19.2.9`.

## 0.2.1

### Patch Changes

- bafaa38: `connect` (and mech-pencil's `wizard`) exits when you quit. Pressing `q` used to clear the screen and leave the process running until it was killed, because the shared TUI harness stopped openTUI's render loop instead of destroying the renderer, so the terminal and stdin were never released. The harness now destroys the renderer, and the process exits normally.
- f8888da: `connect` now shows why a login or logout failed. The error was written into the connection's status line and then immediately replaced when the view re-checked the status, so a failed login looked like nothing happened. It now stays on its own line under the actions until you start another action, and a failed logout no longer shows a still-connected account as disconnected.
- f8888da: `connect` checks each connection's status once when it opens (and again on `r` or after a login or logout), instead of thousands of times a second. An app that passed no optional connections got a new empty list on every render, so every render re-fetched every status and each fetch caused another render.
- f8888da: Interactive screens no longer burn CPU while they sit open. Every screen that binds a key (`connect`, mech-pencil's `wizard`, timetracker's summary, and any list, menu, table or confirm prompt) re-registered its key bindings in an endless loop, re-rendering hundreds of thousands of times and holding a core at 100% or more. Bindings now register once.

## 0.2.0

### Minor Changes

- df686c3: **Breaking:** gitradar's files moved from `~/.agentx` to `~/.helmsmith`. The global repo registry is now `~/.helmsmith/repos.yml`, a project registry is `<repo>/.helmsmith/repos.yml`, and config, data and cache live under `~/.helmsmith/gitradar/`. `GITRADAR_HOME` still relocates config, data and cache together. Old locations are not read. To migrate, run `mkdir -p ~/.helmsmith && mv ~/.agentx/repos.yml ~/.agentx/gitradar ~/.helmsmith/` (and `git mv .agentx/repos.yml .helmsmith/repos.yml` in a repo that keeps one).

### Patch Changes

- First npm release: `npm install -g @helmsmith/gitradar`. The package bundles its `@helmsmith/*` workspace libraries, so it no longer depends on the private `@helmsmith/tui-view-components`, and declares `react` and `@opentui/*` itself. The launcher is now `bin/gitradar.mjs`, which finds the vendored Bun wherever npm installs it; the old `sh` launcher looked only in `<package>/node_modules/.bin`, which `npx` and project installs don't create. `gitradar --version` reports the package version instead of a hard-coded `0.1.0`.

## 0.1.1

### Patch Changes

- d3a0e72: Second slice of the round-2 review (#121):
  
  - #70: `git log` headers are NUL-delimited and the scan splits on `\n` only, so a `|`, `\r` or `\t` in an author name can no longer crash the scan or forge commits for another member; a commit with an unparseable hash or date is skipped with one warning. Same for the PR proxy, which never stores a `NaN` week.
  - #71: the PR proxy resolves the default branch to a SHA and passes `--end-of-options` before every revision, and refuses an option-like `origin/HEAD`.
  - #93: `--demo` never opens the store or offers persistence callbacks, so Manage-tab edits in demo mode cannot overwrite `config.yml`; `--demo` works on a fresh install.
  - #96: `--reset` moves `gitradar.db` (and `-wal`/`-shm`) aside as `.bak-<timestamp>` without opening them, asks first (or `--yes`), and exits 1 when there is nothing to reset; `getDB` creates the data dir and only mentions `--reset` for a real corruption error.
  - #113: an invalid `config.yml` is never written over (`org add`, `org add-team`, the Manage tab) and every reader prints the validation issues; saves patch the YAML document so comments survive, keep a `.bak` and write atomically.
  - #114: an invalid `repos.yml` stops gitradar instead of being replaced by an empty registry; registry writes keep a `.bak` and are atomic.
  - #115: the engine owns the author registry — a Manage-tab rescan or `scan --watch` merges discovered authors into the registry as stored, so TUI assignments are no longer reverted.
- 0c465e6: Security and setup fixes from the 2026-10-19 review (helmsmith #121): the launcher runs Bun with `--no-env-file` and a package-owned `bunfig.toml`, so a `.env` or `bunfig.toml` in the current directory can no longer inject environment or run preload scripts (#69); the rework pass runs `git diff` with `--no-ext-diff --no-textconv` (#69); `gitradar init` no longer crashes on a fresh machine and creates `~/.helmsmith` for the registry (#94); `--skip-cache` skips the GitHub cache write as well as the read, matching the batch path, and every unit-test file now runs with `HOME` and `GITRADAR_HOME` sandboxed (#74). New `tests/e2e` harness (builds `dist`, spawns `bin/gitradar` in a temp home); `test:e2e` runs it; the unit config no longer sweeps up e2e files.
- f3e1835: Third slice of the round-2 review (#121), scan integrity:
  
  - #79: incremental scans use a reachability cursor. Each scan records HEAD (and the default-branch tip for the PR proxy) and the next one walks `HEAD ^lastTip`, so commits that reach the clone after the scan but carry older dates — merged branches, pulls after days away — are counted. A rewritten history falls back to a full walk with hash dedup; state from before this release gets one last date walk with a full timestamp, and no bare date is ever passed to git.
  - #110: chunked first scans keep the newest hashes for dedup and record the real tip as `lastHash`, so the next incremental scan no longer double-counts the overlap.
  - #112: a failed git run (fatal or transient) writes nothing, keeps the repo's cursor, prints `✗`, and makes `scan` exit 1.
  - #116: authors track commits per repo; a forced rescan subtracts that repo's share before re-walking it, so `author list` counts stop inflating.
  - #111: a scan lock in the store (pid-stamped, reclaimed from dead or ancient holders) makes a concurrent scan yield with "scan in progress" and exit 1; cursors are written one repo at a time instead of rewriting every repo from the startup snapshot.
