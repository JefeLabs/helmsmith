---
"@helmsmith/pritty": minor
---

`pritty commit` now groups staged files by change, then by category: the same model call that writes the messages says which files form each change, and pritty makes one commit per change per category, code before tests within each change. A grouping that is not a clean split of the staged files is refused before anything is committed. `"commitGrouping": "category"` keeps the old one-commit-per-category behavior. `--json` commits carry a `change` label when the model gave one.
