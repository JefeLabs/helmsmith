#!/usr/bin/env node
// Plain Node: every command runs here. The connections view, which needs another
// runtime, lives in @helmsmith/pritty-connect and `pritty connect` delegates to it.
await import('../dist/cli.js');
