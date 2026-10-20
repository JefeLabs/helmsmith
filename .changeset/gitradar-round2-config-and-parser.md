---
"@helmsmith/gitradar": patch
---

Second slice of the round-2 review (#121):

- #70: `git log` headers are NUL-delimited and the scan splits on `\n` only, so a `|`, `\r` or `\t` in an author name can no longer crash the scan or forge commits for another member; a commit with an unparseable hash or date is skipped with one warning. Same for the PR proxy, which never stores a `NaN` week.
- #71: the PR proxy resolves the default branch to a SHA and passes `--end-of-options` before every revision, and refuses an option-like `origin/HEAD`.
- #93: `--demo` never opens the store or offers persistence callbacks, so Manage-tab edits in demo mode cannot overwrite `config.yml`; `--demo` works on a fresh install.
- #96: `--reset` moves `gitradar.db` (and `-wal`/`-shm`) aside as `.bak-<timestamp>` without opening them, asks first (or `--yes`), and exits 1 when there is nothing to reset; `getDB` creates the data dir and only mentions `--reset` for a real corruption error.
- #113: an invalid `config.yml` is never written over (`org add`, `org add-team`, the Manage tab) and every reader prints the validation issues; saves patch the YAML document so comments survive, keep a `.bak` and write atomically.
- #114: an invalid `repos.yml` stops gitradar instead of being replaced by an empty registry; registry writes keep a `.bak` and are atomic.
- #115: the engine owns the author registry — a Manage-tab rescan or `scan --watch` merges discovered authors into the registry as stored, so TUI assignments are no longer reverted.
