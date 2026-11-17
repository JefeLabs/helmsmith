# pritty agent files (design)

**Status:** approved by the owner, 2026-11-17 ("both, go ahead"). Decisions marked *owner* are theirs; *my call* marks the author's, listed in §6.

## 1. Intent

pritty 0.8.0 gave agents an interface: args (`--label --type --scope --message --breaking -- paths`), a JSON body (`--input=json`), `--dry-run`, `--output=json`. A consuming repository's agents only learn it if something tells them. `pritty init` already installs the config, `/commit` and `/pr` slash commands, a skill (`.claude/skills/pritty/SKILL.md`) and Copilot prompts. The owner wants two more files, so the dev environments in those repositories use pritty correctly (*owner*):

1. **A committer subagent for Claude Code**, `.claude/agents/pritty.md`. The main agent hands it a finished piece of work and what it was for; the subagent groups it into commits, dry-runs, commits, and can open the PR. It works in its own context and cannot change code.
2. **An `AGENTS.md` section** with the rules for any agent that commits through pritty itself. Codex, Cursor and Copilot's agent mode read `AGENTS.md`.

## 2. Goals, non-goals, anti-goals

**Goals**
- Both files ship in the npm package and `pritty init` installs them (*owner*).
- `--no-agent` and `--no-agents-md` skip them, as `--no-skill` does today (*owner*).
- The subagent can commit and open PRs and cannot edit code (*owner*), enforced, not only asked.
- The `AGENTS.md` section is replaced in place between markers; the rest of the file is never touched (*owner*).

**Non-goals**
- New commit rules: the files teach what 0.8.0 already validates (*owner*).
- workbrokr changes and gitradar changes (separate follow-ups, agreed order).
- Editing a repository's `CLAUDE.md`.

**Anti-goals**
- A subagent that guesses intent from the diff alone, which is the problem 0.8.0 set out to fix. The caller must pass what the work was for.
- `init` overwriting a user's `AGENTS.md` content or their own `.claude/agents/pritty.md`.

## 3. Constraints (from the Claude Code docs, code.claude.com/docs/en/sub-agents and /memory)

- Subagent files: YAML frontmatter, `name` and `description` required; `tools` takes whole tool names only (a `Bash(...)` pattern is not supported there, and a specifier in `disallowedTools` removes all of Bash). Limiting shell commands is done with a `PreToolUse` hook, which may live in the subagent's own frontmatter (`hooks`); exit code 2 blocks the call and its stderr goes back to the subagent.
- Delegation follows the `description` ("use proactively" encourages it); users can call it by name or `@agent-pritty`.
- Claude Code reads `AGENTS.md` only when the repository has no `CLAUDE.md` (v2.1.277+); otherwise a `CLAUDE.md` can import it with `@AGENTS.md`.
- `init` writes integration files only inside a git repository, and skips an existing file unless `--force` (`src/commands/init.ts`).

## 4. Approaches

1. **Both files, one source each, installed by `init`** (*owner* picked "both"). The subagent isolates the commit work for Claude Code; the `AGENTS.md` section reaches every other tool and keeps the knowledge with the agent that wrote the code.
2. Only the `AGENTS.md` section: one file for every tool, but Claude Code sessions with a `CLAUDE.md` never see it, and the main agent's context fills with diffs.
3. Only the subagent: isolation for Claude Code users, nothing for Codex, Cursor or Copilot.

## 5. Design

### 5.1 Files and where they come from

```
apps/pritty/agents/
├── pritty.md          # the Claude Code subagent, installed at .claude/agents/pritty.md
└── AGENTS.section.md  # the AGENTS.md section body, installed between markers
```

Both are listed in the package's `files` and are the single source: `init` reads them from the installed package at run time, so no copy lives in `templates.ts` (*my call*: the skill already exists twice, in `SKILL.md` and `templates.ts`, and the copies have drifted).

### 5.2 The subagent (`agents/pritty.md`)

- Frontmatter: `name: pritty`; a `description` saying it commits finished work and opens PRs through pritty, to be used proactively when the work is done, and that the caller must say what the change was for; `tools: Bash, Read, Grep, Glob, Write` (no Edit); `PreToolUse` hooks on `Bash` and `Write` running `pritty agent-guard` (*my call*). Write is needed only to put a JSON plan or PR body under `.git/pritty/`, because the guard refuses heredocs and pipes; the guard confines Write to that directory.
- Body, in order:
  1. Ask for, or take from the request, what the change was for and the ticket if any. Never infer intent from the diff alone.
  2. Look: `git status`, `git diff`, `git diff --cached`, `git log`.
  3. Plan commits: one category per commit (code, then its tests), the same label on a change's commits (the ticket, else a short effort name), `type(scope): description` with a lowercase imperative description, `--breaking` / `"breaking": true` for breaking changes.
  4. Stage with `git add -- <paths>` when needed.
  5. Write the plan to `.git/pritty/plan.json`, run `pritty commit --input=json --dry-run --output=json < .git/pritty/plan.json`, check it, then the same without `--dry-run`; report the commits from the JSON. (A single commit may use the args form instead.)
  6. When asked, write `{ title, body }` to `.git/pritty/pr.json` and run `pritty pr --input=json --output=json < .git/pritty/pr.json`.
  7. On a refusal, read stderr, fix the plan and retry; never `git commit` directly and never `--no-verify` unless the caller approved bypassing a hook.

### 5.3 `pritty agent-guard` (new hidden subcommand)

Reads a Claude Code `PreToolUse` hook payload (JSON on stdin) and exits 0 when the call is allowed, 2 with a reason on stderr otherwise. For Bash it judges `tool_input.command`; for Write (and Edit) it allows only a `file_path` inside `<cwd>/.git/pritty/`; other tools pass (*my call*: the docs' documented way to limit commands, and pritty is already on the PATH wherever the subagent can work). Allowed:
- `git status`, `git diff`, `git log`, `git show`, `git rev-parse`, `git ls-files`, `git add -- <paths>` (staging is not editing code);
- `pritty` followed by `commit`, `pr`, `categorize`, `--version` or `--help`.

Anything else, and any command containing a shell operator (`;`, `&&`, `||`, `|`, `>`, `<`, `` ` ``, `$(`, a newline), is refused, with one exception: `pritty commit|pr … --input=json < <path>` where the path is inside `.git/pritty/`. A payload that is not valid JSON, or has no command, is refused. Hidden from `pritty --help` (*my call*: it is plumbing for the subagent).

### 5.4 The `AGENTS.md` section (`agents/AGENTS.section.md`)

Short rules for an agent committing through pritty itself:
- the args and JSON forms
- one category per commit, code before tests
- labels
- `--breaking`
- dry run first
- `--output=json` to read results
- `pritty pr --input=json`
- never `git commit -m` for work that should follow the repository's conventions

Installed as:

```
<!-- pritty:begin (managed by `pritty init`; edits inside are replaced) -->
…section…
<!-- pritty:end -->
```

- No `AGENTS.md`: create it with the section.
- An `AGENTS.md` with the markers: replace what is between them on every `init` run, with or without `--force` (*owner*: re-running updates the section).
- An `AGENTS.md` without markers: append a blank line and the section.
- When the repository has a `CLAUDE.md`, print a dim hint that Claude Code reads `AGENTS.md` only through an `@AGENTS.md` import; do not edit `CLAUDE.md` (non-goal).

### 5.5 `init`

- `InitOptions` gains `agent?: boolean` and `agentsMd?: boolean`; the CLI gains `--no-agent` and `--no-agents-md`.
- The subagent is written to `.claude/agents/pritty.md` in a git repository, skipped if it exists unless `--force`.
- The section is installed as in §5.4, in a git repository.
- `--json` lists both in `written` / `skipped`.
- `--no-claude` does not affect them; each has its own flag (*my call*: `--no-claude` today means the slash commands).

### 5.6 Docs and release

README (the init section and a short "agent files" section), both skill copies (mention the subagent and the guard), a changeset (`@helmsmith/pritty` minor: new files, new init flags, new hidden subcommand).

## 6. Calls to check (author's)

- Single source in `apps/pritty/agents/`, read from the package at run time.
- `tools: Bash, Read, Grep, Glob, Write` plus the `PreToolUse` guard: Bash limited to read-only git, `git add -- <paths>` and `pritty commit|pr|categorize`, shell operators refused except one `<` from `.git/pritty/` for `--input=json`; Write limited to `.git/pritty/`.
- `pritty agent-guard` hidden from help.
- `--no-claude` leaves the agent files alone; they have their own flags.
- No edit to `CLAUDE.md`; a hint instead.

## 7. Left to the builder

Exact prose of both files within §5.2 and §5.4; the frontmatter `hooks` syntax per the docs; how `init` resolves the package's `agents/` directory in both `dist` and tests; error wording.
