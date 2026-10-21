---
"@helmsmith/gittyup": patch
---

Auth and AI-call safety (round-2 review):

- A GitHub token taken from the environment (`GITHUB_TOKEN` / `COPILOT_GITHUB_TOKEN`, e.g. in CI) is no longer written into `auth.json`, so it can't replace the token from `gittyup auth login`. `auth.json` is written with owner-only permissions (0600).
- A Copilot completion that was cut off at the model's output limit (`finish_reason: "length"`) is rejected instead of being used, so a truncated file can't pass the resolution gate and get committed.
- `git credential fill` in the token cascade runs from a neutral directory with prompting disabled, so a cloned repo's local `credential.helper` can't execute or block.
