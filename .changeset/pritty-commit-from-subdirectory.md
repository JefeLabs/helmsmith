---
"@helmsmith/pritty": patch
---

`pritty commit` works from a subdirectory of the repository. It used to fail with `nothing staged for src/…` and commit nothing, because git ran in the current directory, where pathspecs are relative to that directory while `git diff` reports paths from the repository root. pritty now runs git from the repository root. This also fixes `pritty categorize --all` from a subdirectory, which missed untracked files outside it and filed the ones inside it under `unknown`.
