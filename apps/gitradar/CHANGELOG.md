# @helmsmith/gitradar

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
- 0c465e6: Security and setup fixes from the 2026-10-19 review (helmsmith #121): the launcher runs Bun with `--no-env-file` and a package-owned `bunfig.toml`, so a `.env` or `bunfig.toml` in the current directory can no longer inject environment or run preload scripts (#69); the rework pass runs `git diff` with `--no-ext-diff --no-textconv` (#69); `gitradar init` no longer crashes on a fresh machine and creates `~/.agentx` for the registry (#94); `--skip-cache` skips the GitHub cache write as well as the read, matching the batch path, and every unit-test file now runs with `HOME` and `GITRADAR_HOME` sandboxed (#74). New `tests/e2e` harness (builds `dist`, spawns `bin/gitradar` in a temp home); `test:e2e` runs it; the unit config no longer sweeps up e2e files.
- f3e1835: Third slice of the round-2 review (#121), scan integrity:
  
  - #79: incremental scans use a reachability cursor. Each scan records HEAD (and the default-branch tip for the PR proxy) and the next one walks `HEAD ^lastTip`, so commits that reach the clone after the scan but carry older dates — merged branches, pulls after days away — are counted. A rewritten history falls back to a full walk with hash dedup; state from before this release gets one last date walk with a full timestamp, and no bare date is ever passed to git.
  - #110: chunked first scans keep the newest hashes for dedup and record the real tip as `lastHash`, so the next incremental scan no longer double-counts the overlap.
  - #112: a failed git run (fatal or transient) writes nothing, keeps the repo's cursor, prints `✗`, and makes `scan` exit 1.
  - #116: authors track commits per repo; a forced rescan subtracts that repo's share before re-walking it, so `author list` counts stop inflating.
  - #111: a scan lock in the store (pid-stamped, reclaimed from dead or ancient holders) makes a concurrent scan yield with "scan in progress" and exit 1; cursors are written one repo at a time instead of rewriting every repo from the startup snapshot.
