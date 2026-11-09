---
"@helmsmith/gittyup": patch
---

`gittyup connect` now shows GitHub as connected whenever gittyup can actually reach GitHub. It only looked at `GITHUB_TOKEN` and `GH_TOKEN`, so a token saved by `gittyup auth login`, from `gh auth login`, or in your git credentials showed as "disconnected" even though `compare`, `prs` and `merge --pr` were using it. It now checks the same places, in the same order, as those commands.
