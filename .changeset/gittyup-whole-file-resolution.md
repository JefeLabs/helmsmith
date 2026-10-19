---
"@helmsmith/gittyup": minor
---

Conflict resolution writes whole files only. `ConflictFile` now carries the complete OURS/THEIRS/BASE versions from the index stages; one gated write path refuses markers, empty results and one-line fragments; manual edit opens the conflicted file with its markers and reopens on refusal; AI auto sends complete files, shows a line diff and confirms before writing (`--yes` to skip); AI suggest takes the last fenced block of the reply; delete/modify conflicts resolve by deletion when the kept side deleted the file. New `settings.ai_model` (`config --model <id>`, default `gpt-4o`). Hardening spec slice 3.1.
