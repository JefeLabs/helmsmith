---
"@helmsmith/gittyup": patch
---

Dashboard and compare correctness (round-2 review):

- `compare` now detects merge conflicts. The check reads `git merge-tree`'s real exit code (1 = conflicts) via a direct invocation; it previously ran through simple-git, which reports that exit code as success, so compare always showed "no conflicts". A genuine merge-tree failure (bad ref, old git) now surfaces as the row's error instead of a guessed boolean.
- The dashboard "last commit", every `compare` column and `pick -i`'s commit list read the named branch's own history (`git log <branch>`), not a `<branch>...HEAD` range relative to whatever is checked out.
- The `compare` result cache is namespaced by the resolved manifest, so one workspace is never shown another workspace's cached rows.
