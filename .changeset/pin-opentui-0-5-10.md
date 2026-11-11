---
"@helmsmith/gittyup": patch
"@helmsmith/gitradar": patch
"@helmsmith/mech-pencil": patch
"@helmsmith/taskmaster": patch
"@helmsmith/timetracker": patch
"@helmsmith/skillzkit": patch
"@helmsmith/workspace": patch
---

Installing from npm now gets OpenTUI 0.5.10 and React 19.2.9, the versions these CLIs are built and tested with. The packages asked for `@opentui/core` and `@opentui/react` as `^0.5.10`, which on a 0.x version allows any 0.5.x, so a fresh install picked the newest one (0.5.17 as of this release). That version requires Node 26.4 or later, so `npm install` printed an `EBADENGINE` warning on Node 24, and the terminal UI ran on an OpenTUI version that was never tested here. Both are now exactly `0.5.10`. `react` was `^19.2.9` and resolved to 19.3.1; it is now exactly `19.2.9`.
