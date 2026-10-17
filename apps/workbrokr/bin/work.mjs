#!/usr/bin/env node
// Plain re-export of the tsup bundle so npm consumers get a runnable bin without a build step.
await import('../dist/cli.js');
