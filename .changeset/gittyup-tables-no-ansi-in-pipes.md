---
"@helmsmith/gittyup": patch
---

`gittyup status` (and the merge/pick results table) no longer writes colour codes when its output goes to a pipe or a file, so `gittyup status | grep …` and `> status.txt` get plain text. On a terminal, table headers now show dim as intended instead of red. The table library added its own red headers and grey borders regardless of where the output went.
