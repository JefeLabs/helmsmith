---
"@helmsmith/gittyup": patch
---

Complete the option-like-ref guard: `fetch` (the remote) and `createConflictBranch` (the constructed branch name) now go through the same check as the other git operations, so no ref-taking path is left unguarded.
