---
"@helmsmith/gittyup": patch
---

Operation safety for merge and cherry-pick (round-2 review):

- A merge or cherry-pick refuses to start when the repo is already mid-merge, mid-cherry-pick, mid-revert, mid-rebase, or carrying an unmerged index, with a message naming the state and how to clear it, instead of operating on top of it (G12).
- A cherry-pick whose change is already present on the target (an "empty" pick — common when back-publishing a fix that reached the branch another way) is dropped with `--empty=drop` instead of stopping with a dangling cherry-pick and a hard "failed" result (G15). Requires git ≥ 2.45.
