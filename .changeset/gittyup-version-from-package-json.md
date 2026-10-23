---
"@helmsmith/gittyup": patch
---

`gittyup --version` reports the installed version — every release so far printed `0.1.0` because the version was a literal in `src/cli.ts`. It is now read from package.json at runtime, like storybrokr and workbrokr.
