---
"@helmsmith/gittyup": patch
---

`GIT_SSH_COMMAND` from your environment reaches git again. 0.3.0's move to simple-git 4 stripped every inherited `GIT_*` variable, so a `GIT_SSH_COMMAND` that picks a key, a ProxyJump or other ssh options was silently ignored by fetch, push and the remote side of merge/pick. It is now allow-listed; every other guarded variable (`GIT_SSH`, `GIT_ASKPASS`, `GIT_CONFIG_*`, `GIT_AUTHOR_*`, `PAGER`, …) is still stripped.
