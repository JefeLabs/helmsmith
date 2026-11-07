---
"@helmsmith/gitradar": minor
---

**Breaking:** gitradar's files moved from `~/.agentx` to `~/.helmsmith`. The global repo registry is now `~/.helmsmith/repos.yml`, a project registry is `<repo>/.helmsmith/repos.yml`, and config, data and cache live under `~/.helmsmith/gitradar/`. `GITRADAR_HOME` still relocates config, data and cache together. Old locations are not read. To migrate, run `mkdir -p ~/.helmsmith && mv ~/.agentx/repos.yml ~/.agentx/gitradar ~/.helmsmith/` (and `git mv .agentx/repos.yml .helmsmith/repos.yml` in a repo that keeps one).
