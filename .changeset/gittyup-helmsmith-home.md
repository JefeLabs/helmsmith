---
"@helmsmith/gittyup": minor
---

**Breaking:** gittyup's config home moved from `~/.agentx/gittyup/` to `~/.helmsmith/gittyup/`, and the per-repo override from `<repo>/.agentx/gittyup/` to `<repo>/.helmsmith/gittyup/`. The env var that relocates the root is now `HELMSMITH_HOME` (was `AGENTX_HOME`). gittyup does not read the old locations, so until you move them it behaves like a fresh install: no saved login, no cache, no manifest. To migrate, run `mv ~/.agentx/gittyup ~/.helmsmith/gittyup` (and `git mv .agentx/gittyup .helmsmith/gittyup` in any repo that commits one), and rename `AGENTX_HOME` in your shell config. The "Created by gittyup" footer on generated PRs now links to `github.com/JefeLabs/helmsmith`, and the editor identifier sent to Copilot is `Helmsmith-Gittyup/0.1.0`.
