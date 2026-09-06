#!/usr/bin/env node
// storybrokr uses no Bun-only APIs, so the stub is a plain re-export of the
// tsup bundle. Kept as a stub (not TS in bin/) so npm consumers get a
// runnable bin without a build step. See docs/toolbox-conventions.md.
await import('../dist/cli.js');
