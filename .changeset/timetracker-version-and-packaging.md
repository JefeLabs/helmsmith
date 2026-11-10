---
"@helmsmith/timetracker": patch
---

`timetracker --version` and the library's `version` export now report the package version; both were a hard-coded `0.1.0`. The package no longer lists the workspace libraries `@helmsmith/cli-kit` and the private `@helmsmith/tui-view-components` as runtime dependencies. They were already bundled into `dist`, but listing them made `npm install @helmsmith/timetracker` fail looking for the private one.
