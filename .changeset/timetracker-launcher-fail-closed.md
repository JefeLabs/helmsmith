---
"@helmsmith/timetracker": patch
---

Security: the launcher only ever runs the Bun installed as the package's `bun` dependency, and timetracker now declares that dependency. Before, timetracker had no `bun` dependency and always ran a bare `bun`, looked up through `PATH` (on Windows, in the current directory first), so a repo you ran it in could supply its own `bun`. A system-wide Bun is no longer needed; if the vendored one is missing, the launcher exits 1 with a reinstall message.
