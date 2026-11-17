---
"@helmsmith/pritty": minor
---

`pritty init` now installs a Claude Code subagent named `pritty` at `.claude/agents/pritty.md` (call it by name or `@agent-pritty`; it reads git, stages with `git add -- <paths>`, commits with `pritty commit` and opens PRs with `pritty pr --input=json`) and a managed section of `AGENTS.md` between `pritty:begin` and `pritty:end` markers, rewritten on every run and leaving the rest of the file alone; `--no-agent` and `--no-agents-md` skip them. The subagent runs under a hidden `pritty agent-guard` `PreToolUse` hook that allows only read-only git, `git add --` and flag-allowlisted `pritty commit|pr|categorize`, and Write/Edit only inside the worktree-aware scratch directory; Claude Code runs it after the workspace trust prompt is accepted. With a `CLAUDE.md`, `init` prints a hint to add `@AGENTS.md` and never edits it; a broken marker pair or a symlinked file is left alone and listed as skipped.
