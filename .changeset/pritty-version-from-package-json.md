---
"@helmsmith/pritty": patch
---

`pritty --version` reports the installed version again — 0.3.1 printed `0.3.0` because the version was a literal in `src/cli.ts`. It is now read from package.json at runtime, like storybrokr and workbrokr.
