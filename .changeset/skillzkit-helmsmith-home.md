---
"@helmsmith/skillzkit": minor
---

**Breaking:** `skillzkit init` writes its config to `~/.helmsmith/skillzkit/config.json` (was `~/.agentx/skillzkit/config.json`), and skillzkit no longer reads the old path. To migrate, run `mkdir -p ~/.helmsmith && mv ~/.agentx/skillzkit ~/.helmsmith/skillzkit`, or re-run `skillzkit init`.
