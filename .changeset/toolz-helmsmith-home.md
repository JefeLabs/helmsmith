---
"@helmsmith/toolz": minor
---

**Breaking:** toolz keeps its catalog and registry in `~/.helmsmith/toolz/` (was `~/.agentx/toolz/`), and the override env var is now `HELMSMITH_TOOLZ_DIR` (was `AGENTX_TOOLZ_DIR`). The old location is not read. To migrate, run `mkdir -p ~/.helmsmith && mv ~/.agentx/toolz ~/.helmsmith/toolz`.
