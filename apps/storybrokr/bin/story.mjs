#!/usr/bin/env node
// `story`, the short name for storybrokr (as `work` is for workbrokr): the same
// re-export of the tsup bundle as bin/storybrokr.mjs. Scripts and hooks call
// `storybrokr`; people type `story`. See docs/toolbox-conventions.md.
await import('../dist/cli.js');
