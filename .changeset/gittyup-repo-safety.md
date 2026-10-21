---
"@helmsmith/gittyup": patch
---

Repo safety and honest exit codes (round-2 review):

- `merge` and `cherry-pick` verify HEAD actually switched to the named branch. A target that happens to match a tracked file or directory (but is not a branch) no longer causes the operation to land on the *current* branch while the result shows success.
- `merge`, `pick` and `fetch` exit non-zero when any repo errored or was left conflicted, instead of always exiting 0.
- A failed `git fetch` is now surfaced: `GitOperations.fetch` uses a raw invocation that rejects on a non-zero exit, where simple-git's `.fetch()` resolved even when the remote did not exist, so a failed fetch was reported as "fetched".
