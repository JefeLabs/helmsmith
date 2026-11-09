---
"@helmsmith/gittyup": patch
---

The `config: <path> [<location>]` line under each command now says `[workspace]` for a `gittyup.yaml` found in the current directory or one of its parents. It used to say `[home]`, which made a workspace manifest look like the global one in `~/.helmsmith/gittyup`.
