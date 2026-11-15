---
"@helmsmith/pritty": minor
---

The default provider is now `claude` (the Claude Code binary on PATH, on its own login) instead of `copilot`. `pritty init` writes `"provider": "claude"`, and the skill it installs checks `which claude` instead of `pritty auth status`, which only lists Copilot logins.

A repository with no `provider` in its config now uses `claude`. To keep Copilot, set `{ "provider": "copilot" }` in `.pritty.json`. There is no automatic fallback: on a machine without `claude`, pritty stops with "No AI provider available. Tried: claude." and lists how to set up each provider.
