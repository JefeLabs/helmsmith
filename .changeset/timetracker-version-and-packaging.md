---
"@helmsmith/timetracker": patch
---

`timetracker --version` and the library's `version` export now report the package version; both were a hard-coded `0.1.0`. The package no longer lists the workspace libraries `@helmsmith/cli-kit` and the private `@helmsmith/tui-view-components` as runtime dependencies. They were already bundled into `dist`, but listing them made `npm install @helmsmith/timetracker` fail looking for the private one. The bundle also keeps the `node:` prefix on builtin imports: it used to turn `import('node:sqlite')` into `import('sqlite')`, so the SQLite store failed to open under Node (`Cannot find package 'sqlite'`). Under Bun, which the launcher uses, it was unaffected.
