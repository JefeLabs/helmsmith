# pritty agent files: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pritty init` installs a Claude Code committer subagent (`.claude/agents/pritty.md`, guarded so it cannot edit code) and a managed `AGENTS.md` section, both shipped in the npm package.

**Architecture:** The two files live once in `apps/pritty/agents/` and ship in the package; `init` reads them from the installed package. A hidden `pritty agent-guard` subcommand is the subagent's `PreToolUse` hook and allows only read-only git, `git add -- <paths>` and pritty's own commands.

**Tech Stack:** TypeScript (ESM), Node 24, commander 15, vitest 5, Biome.

**Spec:** `docs/superpowers/specs/2026-11-17-pritty-agent-files-design.md`

## Before Task 1: branches

Work happens in the workbrokr task effort `apps/pritty` / `agent-files`, branch `feature/apps/pritty--agent-files`, worktree `/Users/edwincruz/Development/Workspaces/jefelabs/helmsmith/.claude/worktrees/_tasks/apps/pritty--agent-files`. Run every command there. Never create or switch branches, never commit on or push to `main`, never use `git stash`.

## Global Constraints

- Node 24; no new dependencies.
- Shipped files: `apps/pritty/agents/pritty.md` (installed at `.claude/agents/pritty.md`) and `apps/pritty/agents/AGENTS.section.md` (installed between markers in `AGENTS.md`); `agents` is added to the package's `files`.
- Markers, exact: `<!-- pritty:begin (managed by \`pritty init\`; edits inside are replaced) -->` and `<!-- pritty:end -->`.
- Subagent frontmatter: `name: pritty`, `tools: Bash, Read, Grep, Glob, Write`, `PreToolUse` hooks on `Bash` and `Write` running `pritty agent-guard`.
- `pritty agent-guard`: hidden subcommand; reads a hook payload (JSON) on stdin; exit 0 = allow, exit 2 + reason on stderr = refuse.
- Guard allowlist (spec §5.3): Bash `git status|diff|log|show|rev-parse|ls-files …`, `git add -- <one or more paths>`, `pritty commit|pr|categorize …`, `pritty --version`, `pritty --help`; anything else refused; `;` `&&` `||` `|` `>` `<` `` ` `` `$(` and newlines refused, except one `<` from a path inside `.git/pritty/` in `pritty commit|pr … --input=json`. Write/Edit allowed only inside `<cwd>/.git/pritty/`.
- `init` flags: `--no-agent`, `--no-agents-md`; `InitOptions.agent?: boolean`, `InitOptions.agentsMd?: boolean`. Integration files only in a git repository; the subagent file is skipped when present unless `--force`; the `AGENTS.md` section is replaced between markers on every run.
- `init` never edits `CLAUDE.md`; with a `CLAUDE.md` present it prints a dim hint about `@AGENTS.md`.
- Commits: conventional subjects with scope `pritty`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. One changeset (Task 4).
- Unit tests: `pnpm --filter @helmsmith/pritty exec vitest run <file>`; e2e after `pnpm --filter @helmsmith/pritty build`: `pnpm --filter @helmsmith/pritty exec vitest run --config vitest.e2e.config.ts <file>`.

## Review Focus

1. **Running `init` twice**: the `AGENTS.md` section appears once, user text before and after the markers is byte-identical. Test: Task 3.
2. **An `AGENTS.md` that does not end in a newline**: the appended section is separated by one blank line; nothing is glued onto the user's last line. Test: Task 3.
3. **Staging without `--`** (`git add src/a.ts`, `git add .`, `git add -A`): refused with a reason that shows the allowed form `git add -- <paths>`. Test: Task 1.
4. **A command chained behind an allowed one** (`git status && rm -rf src`, `git diff | sh`) or a redirect from anywhere but `.git/pritty/` (`pritty commit --input=json < src/plan.json`, `< .git/pritty/../../src/x`): refused. Test: Task 1.
5. **Running `init` outside a git repository**: neither agent file is written, and `--json` reports no such paths. Test: Task 3.

---

### Task 1: `pritty agent-guard`

**Files:**
- Create: `apps/pritty/src/commands/agent-guard.ts`
- Modify: `apps/pritty/src/cli.ts` (hidden command)
- Test: `apps/pritty/src/commands/agent-guard.test.ts`

**Interfaces:**
- Produces:
  - `export type GuardVerdict = { allow: true } | { allow: false; reason: string }`
  - `export function judgeHookPayload(payload: string): GuardVerdict`: parses the hook JSON. For `tool_name: "Bash"` it judges `tool_input.command`. For `tool_name: "Write"` (or `Edit`/`MultiEdit`) it allows only a `tool_input.file_path` that resolves inside `<cwd>/.git/pritty/`, where `cwd` is the payload's `cwd`. Any other tool → allow. Invalid JSON or a missing field → refuse.
  - `export function judgeBash(command: string): GuardVerdict`
  - `export async function runAgentGuard(io: { readStdin(): Promise<string>; err(line: string): void }): Promise<0 | 2>`
  - CLI: `program.command('agent-guard', { hidden: true })`; its action sets `process.exitCode` from `runAgentGuard`.

`judgeBash` rules:
- Trim the command. Refuse if it contains `;`, `&&`, `||`, `|`, `>`, `` ` ``, `$(` or a newline.
- One `<` is allowed only in `pritty (commit|pr) … --input=json … < <path>`, where `<path>` is a single token under `.git/pritty/` (relative, or absolute under the payload `cwd`). Any other `<` is refused. `judgeHookPayload` passes `cwd` through: `judgeBash(command, cwd)`.
- Split on whitespace. The first token must be `git` or `pritty`.
  - `git` subcommands `status`, `diff`, `log`, `show`, `rev-parse`, `ls-files`: allow, with any arguments.
  - `git add`: allow only when `--` follows `add` directly and at least one path follows `--`.
  - `pritty commit`, `pritty pr`, `pritty categorize`, `pritty --version`, `pritty --help`: allow.
  - Everything else: refuse, with the reason naming the allowed forms.

- [ ] **Step 1: Write the failing tests** in `agent-guard.test.ts`. Use `it.each` tables of allow and refuse cases for `judgeBash(cmd, '/repo')`:
  - Allow:
    - `git status`, `git diff --cached`, `git log -5 --format=%s`, `git show HEAD`
    - `git add -- src/a.ts src/a.test.ts`
    - `pritty commit --label abc --type fix --scope api --message "handle 404" --output=json -- src/a.ts`
    - `pritty commit --input=json --dry-run --output=json < .git/pritty/plan.json`
    - `pritty pr --input=json --output=json < /repo/.git/pritty/pr.json`
    - `pritty --version`
  - Refuse (assert `allow: false`, and that the reason contains the fragment shown):
    - `git add src/a.ts` (`git add -- <paths>`)
    - `git add .` and `git add -A` (`git add -- <paths>`)
    - `git commit -m x` (`not allowed`)
    - `git push` (`not allowed`)
    - `rm -rf src` (`not allowed`)
    - `git status && rm -rf src` (`&&`)
    - `git diff | sh` (`|`)
    - `pritty commit --input=json < src/plan.json` (`.git/pritty/`)
    - `pritty commit --input=json < .git/pritty/../../src/x` (`.git/pritty/`)
    - `echo $(whoami)` (`$(`)
    - `pritty commit > out.json` (`>`)

  For `judgeHookPayload`:
  - a Bash payload is judged like `judgeBash`.
  - `{"tool_name":"Write","tool_input":{"file_path":"/repo/.git/pritty/plan.json"},"cwd":"/repo"}` → allow.
  - The same with `/repo/src/a.ts` → refuse.
  - `{"tool_name":"Read",…}` → allow.
  - `not json` → refuse.

  For `runAgentGuard`: returns `2` and writes the reason through `err` for a refused payload, and returns `0` for an allowed one.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/agent-guard.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `agent-guard.ts` and the hidden CLI command. Resolve the `.git/pritty/` containment with `path.resolve(cwd, p)` and a prefix check on `path.resolve(cwd, '.git/pritty') + sep`.
- [ ] **Step 4: Run** the same command, then the full unit suite, `pnpm --filter @helmsmith/pritty typecheck`, and `pnpm exec biome check apps/pritty`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): agent-guard hook limits the committer agent to git reads, staging and pritty`.

### Task 2: The shipped agent files

**Files:**
- Create: `apps/pritty/agents/pritty.md`, `apps/pritty/agents/AGENTS.section.md`
- Modify: `apps/pritty/package.json` (`files` gains `"agents"`), `apps/pritty/src/version.ts` (export the package root)
- Test: `apps/pritty/src/agent-files.test.ts`, `apps/pritty/src/packaging.test.ts`

**Interfaces:**
- Consumes: the guard command name `pritty agent-guard` (Task 1).
- Produces:
  - `export function packageRoot(): string` in `src/version.ts`: the directory of the package's `package.json`, from the existing `findPackageJson`.
  - `export function readAgentFile(name: 'pritty.md' | 'AGENTS.section.md'): string` in `apps/pritty/src/agent-files.ts`: reads `<packageRoot()>/agents/<name>`.

Content (spec §5.2 and §5.4; prose is the builder's, these points are required):
- `pritty.md` frontmatter:
  - `name: pritty`
  - a `description` saying three things: it commits finished work and opens PRs through pritty; use it proactively once a change is done; the caller must say what the change was for (and the ticket, if any)
  - `tools: Bash, Read, Grep, Glob, Write`
  - `hooks` with `PreToolUse` entries for matcher `Bash` and matcher `Write`, each running the command `pritty agent-guard`

  Check the exact `hooks` YAML shape against https://code.claude.com/docs/en/sub-agents. The settings-file shape is `PreToolUse: [{ matcher, hooks: [{ type: command, command }] }]`.
- `pritty.md` body: the seven steps of spec §5.2. Plans are written with the Write tool to `.git/pritty/plan.json`. They are passed as `pritty commit --input=json --dry-run --output=json < .git/pritty/plan.json`, then without `--dry-run`. A PR body goes to `.git/pritty/pr.json` the same way. Never `git commit` and never `--no-verify`. If the guard refuses a command, change the command; do not try to get around the guard.
- `AGENTS.section.md`: a `## Committing with pritty` heading and the rules of spec §5.4, each as one bullet with a runnable example. No markers in this file; `init` adds them.

- [ ] **Step 1: Write the failing tests** in `agent-files.test.ts`:
  - `readAgentFile('pritty.md')` starts with `---\nname: pritty\n` and contains `tools: Bash, Read, Grep, Glob, Write`, `pritty agent-guard`, `--input=json`, `.git/pritty/plan.json` and `--dry-run`.
  - `readAgentFile('AGENTS.section.md')` starts with `## Committing with pritty`, contains `--label`, `--input=json`, `--breaking` and `--output=json`, and does not contain `pritty:begin`.
  - In `packaging.test.ts`, the package `files` include `agents`.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/agent-files.test.ts src/packaging.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two files, `packageRoot`, `readAgentFile` and the `files` entry.
- [ ] **Step 4: Run** the same command, then the unit suite, typecheck and biome. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): ship a committer subagent and an AGENTS.md section`.

### Task 3: `init` installs them

**Files:**
- Modify: `apps/pritty/src/commands/init.ts`, `apps/pritty/src/cli.ts` (init flags and help)
- Create: `apps/pritty/src/commands/_shared/agents-md.ts`
- Test: `apps/pritty/src/commands/_shared/agents-md.test.ts`, `apps/pritty/tests/e2e/init.test.ts`

**Interfaces:**
- Consumes: `readAgentFile` (Task 2).
- Produces:
  - `export const AGENTS_BEGIN: string` and `export const AGENTS_END: string` (the exact markers).
  - `export function upsertSection(existing: string | undefined, section: string): string`. With `undefined`, it returns the markers around the section. With markers present, it replaces the text between them and nothing else. Without markers, it appends: the existing text with its trailing newlines trimmed, a blank line, then the marked section. The result always ends with `\n`.
  - `InitOptions.agent?: boolean`, `InitOptions.agentsMd?: boolean`; CLI `--no-agent`, `--no-agents-md`.

- [ ] **Step 1: Write the failing tests:**
  - `agents-md.test.ts`:
    - `upsertSection(undefined, 'X\n')` is `${AGENTS_BEGIN}\nX\n${AGENTS_END}\n`.
    - With existing `# Mine\n\nkeep\n`, the result starts `# Mine\n\nkeep\n\n${AGENTS_BEGIN}`.
    - Existing text with no trailing newline (`# Mine`) gives `# Mine\n\n${AGENTS_BEGIN}…`.
    - Applying it twice with a new section replaces the section and leaves `# Mine` and a trailing `after\n` paragraph exactly as they were.
  - `tests/e2e/init.test.ts`:
    - In a git repo, `init --json --no-aliases` writes `.claude/agents/pritty.md` (same content as `agents/pritty.md`) and `AGENTS.md` (contains both markers and `## Committing with pritty`).
    - A second run without `--force` skips `.claude/agents/pritty.md` and still lists `AGENTS.md` under `written`. The file holds exactly one `pritty:begin`.
    - `--no-agent --no-agents-md` writes neither file.
    - Outside a git repo, neither file is written.
    - With a `CLAUDE.md` present, stderr (under `--json`) mentions `@AGENTS.md` and `CLAUDE.md` is unchanged.
- [ ] **Step 2: Run** the unit test, then build and run the e2e file. Expected: FAIL.
- [ ] **Step 3: Implement** `agents-md.ts`, the two install steps in `runInit`, and the CLI flags with help text. Put the install steps after the skill step and before the Copilot step. The description of `init` mentions the agent files.
- [ ] **Step 4: Run** the unit suite, then build and run the e2e suite, typecheck and biome. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): init installs the committer agent and the AGENTS.md section`.

### Task 4: Docs and changeset

**Files:**
- Modify: `apps/pritty/README.md` (init section; a short "Agent files" section), `apps/pritty/SKILL.md` and the skill text in `apps/pritty/src/commands/_shared/templates.ts` (both mention the subagent `@agent-pritty`, the guard, and `AGENTS.md`)
- Create: `.changeset/pritty-agent-files.md` (`"@helmsmith/pritty": minor`)
- Test: `apps/pritty/src/commands/_shared/templates.test.ts`

- [ ] **Step 1: Write the failing test** in `templates.test.ts`: `PRITTY_SKILL` mentions `.claude/agents/pritty.md` and `AGENTS.md`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Update** the docs and both skill copies (they must agree), and write the changeset: one paragraph covering the shipped subagent, the `AGENTS.md` section, `--no-agent` / `--no-agents-md`, and the hidden `agent-guard`.
- [ ] **Step 4: Run** the full unit suite, build plus e2e, typecheck and `pnpm exec biome check .`. Expected: PASS.
- [ ] **Step 5: Commit** `docs(pritty): agent files, the guard and the AGENTS.md section`.
