---
"@helmsmith/gittyup": patch
---

Return each repo to its starting state after a merge or cherry-pick (round-2 review, spec §3.2). Uncommitted changes are stashed on the branch the operation started from and popped back there, and HEAD is returned to that branch — instead of the previous flow, which stashed on one branch and popped onto whichever branch the operation left checked out (so edits on `main` resurfaced on the target branch, and the repo was left on the target). When the operation leaves the repo mid-conflict and the user keeps it, the stash is left in place and named rather than popped onto the wrong tree.
