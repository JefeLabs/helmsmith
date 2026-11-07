---
"@helmsmith/taskmaster": minor
---

**Breaking:** taskmaster's home moved from `~/.agentx/taskmaster/` to `~/.helmsmith/taskmaster/`, and repo-local projects from `<repo>/.agentx/taskmaster/` to `<repo>/.helmsmith/taskmaster/`. The root override env var is now `HELMSMITH_HOME` (was `AGENTX_HOME`). Old locations are not read. To migrate, run `mv ~/.agentx/taskmaster ~/.helmsmith/taskmaster` (and `mv .agentx/taskmaster .helmsmith/taskmaster` in repos with local projects). `taskmaster init --repo` now adds only `.helmsmith/taskmaster/` to `.gitignore` rather than the whole parent directory, because other tools keep committed files there (workbrokr's `.helmsmith/hooks`).
