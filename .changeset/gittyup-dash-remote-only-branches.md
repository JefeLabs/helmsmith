---
"@helmsmith/gittyup": patch
---

`gittyup status` reads a branch that exists only on the remote. In a fresh clone only the default branch exists locally, so every other branch in the manifest (`develop`, `staging`, …) showed `error` as its last commit and a `✓` status, as if it were clean and up to date. Those rows now show the remote branch's last commit and the status `☁ remote only`. A branch that exists neither locally nor on the remote shows `⚠ no such branch` instead of `✓`, and its Last Commit column shows `-` instead of `error`. Any other failure to read a branch shows `⚠ unreadable`.

### JSON contract

- `status --json` branch rows gain `local: boolean | null`: whether the branch exists locally, or `null` when the read failed before that was known.
- A remote-only branch is now a normal row: `local: false`, `tracking: true`, `lastCommit` from `origin/<branch>`, and `ahead`/`behind` `null`, because there is no local branch to compare. It used to be an error row with `tracking: false`, even though `origin/<branch>` existed.
- A branch that exists neither locally nor on the remote keeps its error row. Its `error` now reads `no branch '<b>' locally or at origin/<b>` instead of git's `ambiguous argument` message, and its `trackingBranch` names the remote ref that was checked.
