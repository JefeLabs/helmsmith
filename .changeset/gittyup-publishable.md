---
"@helmsmith/gittyup": patch
---

Make the package installable from npm (round-2 review, C6). The build bundles the `@helmsmith/*` workspace libraries (`cli-kit`, `tui-view-components`) into `dist`, so the published package no longer declares `workspace:*` dependencies that npm cannot resolve — `@helmsmith/tui-view-components` is private and unpublished. The third-party peers the bundled TUI needs (`@opentui/core`, `@opentui/react`, `react`) are declared as real dependencies, matching the other toolbox CLIs. A packaging test asserts the published `dependencies` contain no `workspace:` range and no `@helmsmith/*` package.
