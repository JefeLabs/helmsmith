---
"@helmsmith/gittyup": patch
"@helmsmith/toolz": patch
"@helmsmith/mech-pencil": patch
---

Security: the launcher only ever runs the Bun installed as the package's `bun` dependency. When that dependency couldn't be resolved it used to fall back to a bare `bun`, which is looked up through `PATH` (on Windows, in the current directory first), so a repo you ran the CLI in could supply its own `bun`. It now exits 1 with a reinstall message instead.
