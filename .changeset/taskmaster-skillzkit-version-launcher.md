---
"@helmsmith/taskmaster": patch
"@helmsmith/skillzkit": patch
---

`taskmaster --version` and `skillzkit --version` report the package version; both printed a hard-coded `0.1.0`. The skillzkit TUI header showed the same `v0.1.0` and now shows the real version. The launchers no longer fall back to a `bun` found on PATH when the bundled Bun is missing: a bare `bun` is looked up through PATH, and on Windows in the current directory first, so a repo the CLI runs in could plant one. They now exit 1 with a reinstall message, as gittyup's, gitradar's, mech-pencil's, toolz's and timetracker's launchers already do.
