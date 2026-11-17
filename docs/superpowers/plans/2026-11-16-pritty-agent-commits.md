# pritty agent-written commits and labelled subjects: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pritty commit` and `pritty pr` take their content from args, a JSON body on stdin, or the interactive model flow, each with `--dry-run` and `--output=json`; commit subjects can carry a leading `LABEL`, and a PR whose commits share one label gets `LABEL: summary [types] [scopes]`.

**Architecture:** A pure label module (grammar, normalisation, parsing) and a pure planner for explicit commits sit under `apps/pritty/src/commands/_shared/`; `runCommit` and `runPr` pick an input, build the same plan types they use today, and reuse today's commit and PR mechanics. Parsers that read `type(scope):` (pritty, gitradar, skoolscout's commit-msg hook) strip an optional upper-case label first.

**Tech Stack:** TypeScript (ESM), Node 24, commander 15, zod 4, @inquirer/prompts, simple-git, vitest 5, Biome. gitradar: vitest. skoolscout hook: POSIX sh.

**Spec:** `docs/superpowers/specs/2026-11-16-pritty-agent-commits-design.md` (approved; amended 698cab4 with §5.8.1). Section numbers below refer to it.

## Before Task 1: branches

Branches and worktrees are managed by workbrokr. Never run `git checkout -b`, `git switch -c`, `git worktree add` or `git branch`, and never commit on or push to `main` (its hooks refuse both). Do not use `git stash`.

- helmsmith work (Tasks 1–12, 14) happens in the workbrokr effort `apps/pritty`, branch `feature/apps/pritty`, worktree `/Users/edwincruz/Development/Workspaces/jefelabs/helmsmith/.claude/worktrees/apps/pritty`, started with `work start --area apps/pritty --type feature --mode backend` (no services; `pnpm install` ran as its refresh step). Run every command from that worktree.
- The effort's scope is `apps/pritty/**` plus the shared `docs/**`, `.changeset/**`, `README.md` and `pnpm-lock.yaml`. Task 3's `apps/gitradar` edits draw an out-of-scope warning from the pre-commit hook; that warning is expected and does not block the commit.
- Task 13 is in skoolscout-com (`/Users/edwincruz/Development/Workspaces/skoolscout/skoolscout-com`), on its own workbrokr effort, which the owner starts.
- Opening the PRs is the owner's step (`work pr`).

## Global Constraints

- Node 24; ESM TypeScript; no new runtime dependencies (`@inquirer/prompts` already provides `input`).
- Label grammar after normalisation: `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`. Normalisation: trim, upper-case, each run of whitespace → one `-`. Anything else (`/`, `_`, `--`, punctuation) is refused, not converted (§5.1).
- Subject format: `<LABEL> <type>(<scope>)[!]: <description>`; without a label, today's `<type>(<scope>)[!]: <description>`.
- Labels only for commit styles `conventional` and `angular`.
- `commitLabels` config key, boolean, default `false` (§2).
- `--json` contract (`_shared/output.ts`): stdout carries exactly one JSON line; human lines go to stderr; failures are a message on stderr and exit 1, nothing on stdout.
- `--output=json` is accepted by every command and means the same as `--json`; `--output=text` is the default; any other value is refused.
- `--input=json` reads one JSON document from stdin; any other value is refused; `--input` together with args (`--message` for commit, `--title`/`--body`/`--body-file` for pr) is refused.
- Commit subject over 72 characters: warning on stderr, never a refusal.
- pritty never rewrites the agent's type, scope or description; it may add trailers and normalise the label (rule C).
- Every helmsmith commit in this plan uses a conventional subject with a scope (`feat(pritty): …`, `fix(gitradar): …`) and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The final changesets live in Task 12; no other task adds one.
- Run commands from the helmsmith root. Unit tests: `pnpm --filter @helmsmith/pritty exec vitest run <file>`; e2e needs a build first (`pnpm --filter @helmsmith/pritty build`).

## Review Focus

1. **Paths given from a subdirectory** (`cd apps/x && pritty commit … -- src/a.ts`): the path resolves from the current directory, like `git add`. Test: Task 6, `stagedFor` from a subdirectory.
2. **A label pasted with underscores or mixed case** (`wedmodd_23444`, `Wedmodd-23444`): mixed case is upper-cased; the underscore is refused with a message naming the character. Test: Task 1.
3. **A staged rename where the agent lists only the new path**: the deletion of the old path stays staged, and pritty says so. After every args or JSON run, pritty lists on stderr the staged files it left uncommitted. Test: Task 7.
4. **`--input=json` with nothing piped** (stdin is a terminal) or with an empty or non-JSON stdin: refused at once with "expected a JSON document on stdin", never waits for input. Test: Task 7 (commit) and Task 10 (pr).
5. **A description that already carries a prefix** (`--message "fix(api): handle 404"`): refused with "pass the description only; the type and scope go in --type and --scope", so the subject never doubles up. Test: Task 6.

---

### Task 1: Label grammar module

**Files:**
- Create: `apps/pritty/src/commands/_shared/label.ts`
- Test: `apps/pritty/src/commands/_shared/label.test.ts`

**Interfaces:**
- Produces:
  - `export const LABEL_RE: RegExp` (the grammar above)
  - `export type LabelResult = { ok: true; label: string } | { ok: false; error: string }`
  - `export function normalizeLabel(raw: string): LabelResult` (strict: for args, JSON and prompt answers)
  - `export function labelFromChange(change: string | undefined, max = 24): string | undefined` (lenient: for model-written change names; upper-case, every run of characters outside `[A-Za-z0-9]` → `-`, hyphens trimmed from both ends, cut at the last hyphen at or before `max` characters; `undefined` when nothing is left)
  - `export function splitLabel(subject: string): { label?: string; rest: string }` (case-sensitive; a label is recognised only when followed by one space and a lower-case `type`, optional `(scope)`, optional `!`, then `:`)

- [ ] **Step 1: Write the failing tests** in `label.test.ts`:
  - `normalizeLabel('status logging')` → `{ ok: true, label: 'STATUS-LOGGING' }`; `'wedmodd-23444'` → `'WEDMODD-23444'`; `'  Status   Logging '` → `'STATUS-LOGGING'`; `'Wedmodd-23444'` → `'WEDMODD-23444'`.
  - Refused (`ok: false`): `''`, `'   '`, `'wedmodd_23444'` (error contains `_`), `'family/help'` (error contains `/`), `'a--b'`, `'fix.'`.
  - `labelFromChange('login rate limit')` → `'LOGIN-RATE-LIMIT'`; `labelFromChange("users' phone/email")` → `'USERS-PHONE-EMAIL'`; `labelFromChange('a very long change name that keeps going')` has length ≤ 24 and does not end with `-`; `labelFromChange('  ')` and `labelFromChange(undefined)` → `undefined`.
  - `splitLabel('WEDMODD-23444 fix(issue-report): x')` → `{ label: 'WEDMODD-23444', rest: 'fix(issue-report): x' }`; `splitLabel('fix(api): x')` → `{ rest: 'fix(api): x' }`; `splitLabel('Merge branch develop')` → no label; `splitLabel('API fix: x')` → `{ label: 'API', rest: 'fix: x' }`; `splitLabel('wedmodd-1 fix: x')` → no label (lower case).
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/_shared/label.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the four exports in `label.ts`. Error text names the offending character: ``label "wedmodd_23444" can hold only letters, digits and single hyphens (found "_")``.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): label grammar, normalisation and parsing`.

### Task 2: pritty's subject parser reads labels

**Files:**
- Modify: `apps/pritty/src/commands/_shared/conventional.ts` (`parseConventional`, `retypeForBranch`, `applySubjectOverrides`)
- Modify: `apps/pritty/src/commands/_shared/labels.ts` (`inferLabels`)
- Create test: `apps/pritty/src/commands/_shared/conventional.test.ts`

**Interfaces:**
- Consumes: `splitLabel` (Task 1).
- Produces:
  - `ConventionalSubject` gains `label?: string`.
  - `export function formatConventional(p: ConventionalSubject): string` → `[label ]type[(scope)][!]: description`.
  - `retypeForBranch` and `applySubjectOverrides` rebuild subjects with `formatConventional`, so a label in `message` survives.

- [ ] **Step 1: Write failing tests** in `conventional.test.ts`:
  - `parseConventional('WEDMODD-23444 fix(issue-report)!: x')` → `{ label: 'WEDMODD-23444', type: 'fix', scope: 'issue-report', breaking: true, description: 'x' }`; an unlabelled subject parses as today (no `label` key).
  - `formatConventional` round-trips both.
  - `retypeForBranch([{ category: 'app', message: 'ABC-1 feat(x): y', files: [] }], 'fix/x', 'conventional').plan[0].message` → `'ABC-1 fix(x): y'`.
  - `applySubjectOverrides([{ category: 'app', message: 'ABC-1 feat(x): y', files: [] }], { scope: 'z' }).plan[0].message` → `'ABC-1 feat(z): y'`.
  - `inferLabels([{ subject: 'ABC-1 fix(x): y' }, { subject: 'ABC-1 feat(x): z' }])` → `['bug', 'enhancement']`.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/_shared/conventional.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**: `parseConventional` calls `splitLabel` and parses `rest`; `inferLabels` uses `parseConventional` instead of its own regex.
- [ ] **Step 4: Run** that file plus `src/commands/commit.test.ts src/commands/pr.test.ts`. Expected: PASS (existing tests unchanged).
- [ ] **Step 5: Commit** `feat(pritty): conventional parser accepts a leading label`.

### Task 3: gitradar parses labelled subjects

**Files:**
- Modify: `apps/gitradar/src/collector/git.ts` (`parseConventionalCommit`)
- Test: `apps/gitradar/src/__tests__/git.test.ts` (`describe('parseIntent')`)

**Interfaces:**
- Produces: `parseConventionalCommit(subject)` strips a leading label with a case-sensitive pattern equal to Task 1's `splitLabel` (copy the pattern; gitradar does not import pritty), then applies the existing `CONVENTIONAL_RE` unchanged. The label is not returned.

- [ ] **Step 1: Write failing tests** in the `parseIntent` block: `parseIntent('WEDMODD-23444 fix(issue-report): x')` → `'fix'`; `parseConventionalCommit('STATUS-LOGGING test(issue-report): x')` → `{ intent: 'test', scope: 'issue-report', breaking: false }`; `parseIntent('update feat: x')` → `'other'` (a lower-case first word is not a label).
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/gitradar exec vitest run src/__tests__/git.test.ts`. Expected: FAIL on the labelled cases.
- [ ] **Step 3: Implement** the strip in `parseConventionalCommit`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `fix(gitradar): read type and scope after a leading commit label`.

### Task 4: `--output=json` on every command

**Files:**
- Modify: `apps/pritty/src/cli.ts`
- Test: `apps/pritty/tests/e2e/json.test.ts`

**Interfaces:**
- Produces: `function addOutputOption(cmd: Command): Command` in `cli.ts`, applied to every command that has `--json` today (`auth login|logout|status`, `init`, `categorize`, `cache clear|path`, `commit`, `pr`, `rebase`). It adds `--output <format>` (`json` or `text`) and a `preAction` hook that refuses any other value (``--output must be json or text``) and sets the command's `json` option to `true` when the format is `json`.

- [ ] **Step 1: Write failing e2e tests**: `pritty categorize --output=json` in a repo with one staged file prints the same single JSON line as `pritty categorize --json`; `pritty categorize --output=yaml` exits 1 with `--output must be json or text` on stderr and nothing on stdout.
- [ ] **Step 2: Build and run** `pnpm --filter @helmsmith/pritty build && pnpm --filter @helmsmith/pritty exec vitest run --config vitest.e2e.config.ts tests/e2e/json.test.ts`. Expected: FAIL (unknown option).
- [ ] **Step 3: Implement** `addOutputOption` and apply it.
- [ ] **Step 4: Build and run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): --output=json on every command, --json kept as its shorthand`.

### Task 5: Labels in the commit plan and the JSON outcome

**Files:**
- Modify: `apps/pritty/src/config.ts` (`ConfigSchema`)
- Modify: `apps/pritty/src/ai.ts` (`CommitMessage`)
- Modify: `apps/pritty/src/commands/_shared/plan.ts` (`composeCommitMessage`, new `subjectOf`, new `applyLabels`)
- Modify: `apps/pritty/src/commands/commit.ts` (`CommitOutcome`, the dry-run and commit outcome mapping)
- Test: `apps/pritty/src/commands/_shared/plan.test.ts`, `apps/pritty/src/commands/commit.test.ts`

**Interfaces:**
- Produces:
  - `ConfigSchema.commitLabels: z.boolean().default(false)`.
  - `CommitMessage.label?: string` (already normalised; `message` stays `type(scope): description`).
  - `export function subjectOf(c: CommitMessage): string` → `` `${c.label} ${c.message}` `` or `c.message`.
  - `composeCommitMessage` uses `subjectOf(c)` as the first line.
  - `export function applyLabels(plan: readonly CommitMessage[], o: { explicit?: string; chosen?: string; ticket?: string; runLabel?: string }): CommitMessage[]`: a commit that already has `label` keeps it; otherwise the first of `explicit`, `chosen`, `ticket`, `labelFromChange(c.change)`, `runLabel` that is set.
  - `CommitOutcome.commits[]` gains `label?`, `type?`, `scope?`, `description?` (from `parseConventional(subjectOf(c))`); `message` becomes `subjectOf(c)`, the first line as committed (its meaning today, now with the label).

- [ ] **Step 1: Write failing tests**:
  - `plan.test.ts`: `composeCommitMessage({ label: 'ABC-1', category: 'app', message: 'fix(x): y', body: 'b', files: [] }, ['T: v'])` → `'ABC-1 fix(x): y\n\nb\n\nT: v'`; `applyLabels` priority: `explicit` wins over `ticket`; a commit with `change: 'login rate limit'` and no other source gets `'LOGIN-RATE-LIMIT'`; an existing `label` is kept.
  - `commit.test.ts` (existing `fakes`): the `--json` outcome of a two-commit model run has `type`, `scope` and `description` on each commit, and no `label` while `commitLabels` is off.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/_shared/plan.test.ts src/commands/commit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the listed changes. The plan cache needs no change: `label` rides in `CommitMessage`, and `reconcileCommitPlan` keeps every field except `change` in `category` mode.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): commitLabels setting and labelled subjects in the commit plan`.

### Task 6: Planner for explicit commits (args and JSON)

**Files:**
- Create: `apps/pritty/src/commands/_shared/explicit.ts`
- Modify: `apps/pritty/src/git.ts` (`GitOps.stagedFor`)
- Test: `apps/pritty/src/commands/_shared/explicit.test.ts`, `apps/pritty/src/git.ops.test.ts`

**Interfaces:**
- Consumes: `normalizeLabel` (Task 1), `parseConventional` (Task 2), `subjectOf` (Task 5), `isCommitType`, `isCommitScope` (conventional.ts), `categorize`, `CategoryMap` (categorizer.ts). `--trailer` lines stay validated where they are today, in `validateOverrides`, for every input.
- Produces:
  - `export interface ExplicitCommit { label?: string; type: string; scope: string; description: string; body?: string; paths?: string[] }`
  - `export function parseCommitInput(text: string): ExplicitCommit[]`: parses `{ "commits": [ { label?, type, scope, description, body?, files? } ] }` with zod (`files` → `paths`; `message`, `category`, `sha`, top-level `dryRun` and unknown keys ignored); throws one `Error` listing every problem; an empty or non-JSON text throws ``expected a JSON document on stdin: { "commits": [...] }``.
  - `export function planExplicit(commits: readonly ExplicitCommit[], ctx: { staged: readonly string[]; matched: ReadonlyMap<string, readonly string[]>; categories: CategoryMap; labelsRequired: boolean }): { plan: CommitMessage[]; warnings: string[] }` (pure; `matched` maps each given path to the staged files it names).
  - `GitOps.stagedFor(pathspecs: readonly string[], fromDir: string): Promise<Map<string, string[]>>`: for each pathspec, `git diff --cached --name-only --no-renames -z -- <pathspec>` run in `fromDir` (so it resolves like `git add`), output repo-root-relative; `[]` when it matches nothing or lies outside the repository.

`planExplicit` rules (all problems collected, then one `Error` with one problem per line, prefixed with the commit's 1-based position when there are several):
- label: normalised when given; missing when `labelsRequired` → ``--label is required: this repository sets commitLabels``.
- type: `isCommitType`; scope: `isCommitScope`.
- description: non-empty; first word not capitalised (`/^[A-Z][a-z]+([^A-Za-z]|$)/` refused, acronyms pass); no trailing `.`; refused when `parseConventional(description)` succeeds (Review Focus 5).
- files: a given path with no match → ``<path> matches no staged file``; no paths → every staged file, allowed only for a single commit; a file in two commits → refused, naming both positions.
- one category per commit (by `categorize`) → otherwise refused, naming each category and its files; a `test` or `storybook` commit must have type `test`; any other category must not.
- order: by label in first-appearance order (unlabelled commits form one group), and inside a group code categories in categorizer order, then `test`, then `storybook`.
- warnings: a subject (`subjectOf`) over 72 characters → ``subject is N characters; aim for 72 or fewer``.
- each plan entry: `{ label?, category, message: \`${type}(${scope}): ${description}\`, body?, files }`.

- [ ] **Step 1: Write failing tests** in `explicit.test.ts` (staged `['src/a.ts', 'src/a.test.ts', 'src/b.ts']`, default categories):
  - one commit `fix`/`api`/`handle 404` with paths `['src/a.ts']` → plan `[{ category: 'app', message: 'fix(api): handle 404', files: ['src/a.ts'] }]`.
  - label `'wedmodd 23444'` → `label: 'WEDMODD-23444'`.
  - every refusal above, each asserted by a message fragment; two bad commits produce one error containing both positions.
  - JSON body with test before code under one label → plan puts `app` first; two labels keep first-appearance order.
  - `--message "fix(api): handle 404"` style description refused (Review Focus 5).
  - `parseCommitInput('')`, `parseCommitInput('nope')` throw the stdin message; extra keys (`message`, `sha`, `dryRun`) are ignored.
  - `git.ops.test.ts` (real temp repo via `src/testing/repo.ts`): `stagedFor(['a.ts'], <repo>/src)` returns `['src/a.ts']` (Review Focus 1); an unstaged path returns `[]`.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/_shared/explicit.test.ts src/git.ops.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `explicit.ts` and `stagedFor`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): plan commits from explicit args or a JSON body`.

### Task 7: `pritty commit` args and JSON inputs

**Files:**
- Modify: `apps/pritty/src/commands/commit.ts` (`CommitOptions`, `CommitDeps`, `runCommit`)
- Create: `apps/pritty/src/stdin.ts`
- Modify: `apps/pritty/src/cli.ts` (commit command)
- Test: `apps/pritty/src/commands/commit.test.ts`

**Interfaces:**
- Consumes: `parseCommitInput`, `planExplicit`, `GitOps.stagedFor` (Task 6); `subjectOf`, `composeCommitMessage` (Task 5).
- Produces:
  - `CommitOptions` gains `label?: string; message?: string; body?: string; input?: string; paths?: string[]`.
  - `CommitDeps` gains `readStdin?: () => Promise<string>`, `stdinIsTTY?: boolean`, `cwd?: string` (defaults: `readStdin` from `stdin.ts`, `process.stdin.isTTY`, `process.cwd()`).
  - `export function readStdin(): Promise<string>` in `stdin.ts`.
  - CLI: `--label <label>`, `--message <text>`, `--body <text>`, `--input <format>`, and `.argument('[paths...]')` (paths after `--`).

Behaviour:
- Input selection: `--message` → args; `--input=json` → JSON; both → ``pass --message or --input, not both``; `--input` other than `json` → refused; `--body` without `--message` → refused; with `--input=json` and `stdinIsTTY` → the stdin error at once (Review Focus 4).
- Args and JSON: no ticket context, no model, no plan cache, no retyping, no `--type`/`--scope` overrides applied after planning. `labelsRequired` = `config.commitLabels`. `--commit-style` other than `conventional`/`angular` refused.
- Show the plan as today (grouped by label instead of change), print `warnings` on stderr, then `--dry-run` → outcome without `sha`; otherwise confirm unless `auto`, then commit in order with `composeCommitMessage(c, trailers)` and `git.commit(…, c.files, …)`.
- Factor today's step 7 loop into `async function commitAll(plan, ctx): Promise<CommitOutcome['commits']>`, used by all three inputs. On a git failure: stderr ``✗ failed to commit <subject>: <error>; already committed: <sha> <subject>, …``, then rethrow (exit 1).
- After an args or JSON run that committed, list on stderr the staged files still uncommitted (`git.getStaged()`), when any (Review Focus 3).
- `--label` with neither input (interactive run): `explicit` label for every commit (used in Task 8).

- [ ] **Step 1: Write failing tests** with `fakes` extended by `stagedFor`, `readStdin` and `stdinIsTTY`:
  - args: `{ message: 'handle 404', type: 'fix', scope: 'api', label: 'abc 1', paths: ['src/a.ts'] }` → one commit, message first line `ABC-1 fix(api): handle 404`, files `['src/a.ts']`, no `generate` call.
  - args `--dry-run --json`: stdout one line, `dryRun: true`, no `sha`, no `commit` call.
  - JSON: two commits from `readStdin` → two commits in planned order; the outcome's `message`s are the labelled subjects.
  - `--message` with `--input=json` refused; `--input=json` with `stdinIsTTY: true` refused before `readStdin` is called; `--input=yaml` refused.
  - `commitLabels: true` and no `--label` → refused.
  - `failCommits: 1` on the second of two JSON commits → error mentions the first sha; stdout empty under `--json`.
  - staged `['src/a.ts', 'src/old.ts']`, args commit only `src/a.ts` → stderr names `src/old.ts` as left staged.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/commit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the options, deps, input selection, `commitAll`, `stdin.ts` and the CLI flags.
- [ ] **Step 4: Run** the same command plus `pnpm --filter @helmsmith/pritty typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): commit from args or a JSON body on stdin`.

### Task 8: Interactive labels

**Files:**
- Modify: `apps/pritty/src/commands/_shared/prompts.ts` (`input`)
- Modify: `apps/pritty/src/commands/_shared/ticket-context.ts` (extract `lookupTicket`)
- Modify: `apps/pritty/src/ai.ts` (`generateCommitMessages` context and prompt)
- Modify: `apps/pritty/src/commands/commit.ts` (model path)
- Test: `apps/pritty/src/commands/commit.test.ts`, `apps/pritty/src/ai.prompt.test.ts`, `apps/pritty/src/commands/_shared/ticket-context.test.ts`

**Interfaces:**
- Consumes: `applyLabels` (Task 5), `normalizeLabel`, `labelFromChange` (Task 1), `styleHasTypes`.
- Produces:
  - `export const input = guardPrompt((o: { message: string; default?: string }, ctx?: PromptContext) => inquirerInput(o, ctx))`; `CommitDeps.prompts.input`.
  - `export async function lookupTicket(config: Config, ticket: string): Promise<ValidationResult | null>`: the cache-then-adapter lookup now inside `resolveTicketContext` step 4, without printing or exiting; `resolveTicketContext` calls it. `CommitDeps.lookupTicket` (default `lookupTicket`).
  - `generateCommitMessages(groups, diff, config, ticket?, context: { branch?: string; labels?: boolean })`: with `labels`, the `change` key is described as "a name of two to four words for the change"; in `category` grouping, every entry also carries one shared `change` name for the whole set.

Behaviour, only when `config.commitLabels` and `styleHasTypes(config.commitStyle)`:
- `explicit` = `--label` (normalised; refused when invalid). If no `explicit` and no detected ticket and the run is attended: ask `Label for these commits (Jira ticket or effort name, Enter for the model's names):`; blank → none; invalid → say why and ask again. If `config.ticket?.validation` is set and the answer matches `^(?:<ticket.pattern>)$` (case-insensitive), call `lookupTicket`: not found → warning, or refusal when `validateStrict`.
- `runLabel` = `labelFromChange` of the first `change` in the model's raw answer, read before `reconcileCommitPlan` (which drops `change` in `category` mode).
- After overrides: `plan = applyLabels(plan, { explicit, chosen, ticket: ticketCtx?.ticket ?? undefined, runLabel })`, before the plan is shown and cached.
- With `commitLabels` off: an explicit `--label` still applies to every commit; no prompt; no model labels.

- [ ] **Step 1: Write failing tests**:
  - `commit.test.ts`: `commitLabels: true`, attended, no ticket, `input` answers `'wedmodd-23444'` → every subject starts `WEDMODD-23444 `; answer `''` with model changes `'login rate limit'` → `LOGIN-RATE-LIMIT `; `--json` run → `input` never called; ticket `ABC-9` detected → no prompt, label `ABC-9`; `commitLabels: false` → no prompt and unlabelled subjects; `--label foo` with labels off → `FOO ` on every subject.
  - `ai.prompt.test.ts`: with `{ labels: true }` and `commitGrouping: 'category'` the system prompt asks for one shared `change` name; without `labels` the prompt is unchanged from today.
  - `ticket-context.test.ts`: `lookupTicket` returns the cached result without calling the adapter.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/commit.test.ts src/ai.prompt.test.ts src/commands/_shared/ticket-context.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the listed changes.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): label interactive commits from the ticket, a prompt or the model's change names`.

### Task 9: PR title from a shared label

**Files:**
- Modify: `apps/pritty/src/commands/_shared/conventional.ts`
- Modify: `apps/pritty/src/git.ts` (`log` marks merges)
- Modify: `apps/pritty/src/commands/pr.ts` (model path, `--title` path, in-place update of an existing PR)
- Test: `apps/pritty/src/commands/_shared/conventional.test.ts`, `apps/pritty/src/commands/pr.test.ts`

**Interfaces:**
- Consumes: `parseConventional` with `label` (Task 2).
- Produces:
  - `export interface SharedLabel { label: string; tags: string[] }`
  - `export function sharedLabel(commits: ReadonlyArray<{ subject: string; merge?: boolean }>): SharedLabel | null`: input newest first (git log order); merges skipped; null unless every remaining commit parses with the same label. `tags` = each type once in `TYPE_RANK` order, then each scope once in chronological order of first use (iterate oldest first).
  - `export function labelledPrTitle(modelTitle: string, shared: SharedLabel): string` → `` `${label}: ${summary} [t1] [t2] [s1]` `` where `summary` is `modelTitle` without any leading `LABEL: ` or `type(scope):` prefix, first word lower-cased as `conventionalPrTitle` does.
  - `export function addSharedLabel(title: string, shared: SharedLabel): string`: prefixes `` `${label}: ` `` unless the title starts with it; appends each `[tag]` not already in the title. Nothing else changes.
  - `GitOps.log` entries gain `merge?: true` (hashes from `git rev-list --merges <base>..<head>`).

- [ ] **Step 1: Write failing tests**:
  - `conventional.test.ts`: commits (newest first) `ABC-1 test(issue-report): b`, `ABC-1 fix(issue-report): a`, a merge `Merge remote-tracking branch 'origin/develop'` → `{ label: 'ABC-1', tags: ['fix', 'test', 'issue-report'] }`; one unlabelled non-merge commit → `null`; two labels → `null`.
  - `labelledPrTitle('fix(api): Stop logging exception text', shared)` → `'ABC-1: stop logging exception text [fix] [test] [issue-report]'`.
  - `addSharedLabel('ABC-1: my words [fix]', shared)` → `'ABC-1: my words [fix] [test] [issue-report]'`; applied twice gives the same result.
  - `pr.test.ts`: model path with shared-label commits → created PR title is the `labelledPrTitle` form; mixed labels → today's `type(scope): summary`; `--title 'my words'` → `'ABC-1: my words [fix] [test] [issue-report]'`; existing open PR updated in place with `--title` → `updatePR` patch title gets the label and tags.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/_shared/conventional.test.ts src/commands/pr.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**; in the existing-PR branch, read `git.log(await git.resolveBaseRef(effectiveBase))` to compute the shared label before patching.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): PR title carries the label every commit shares`.

### Task 10: `pritty pr` JSON body, dry-run JSON and richer output

**Files:**
- Modify: `apps/pritty/src/commands/pr.ts` (`PrOptions`, `PrDeps`, `PrOutcome`, input selection, dry run)
- Create: `apps/pritty/src/commands/_shared/pr-input.ts`
- Modify: `apps/pritty/src/cli.ts` (pr `--input <format>`)
- Test: `apps/pritty/src/commands/pr.test.ts`, `apps/pritty/src/commands/_shared/pr-input.test.ts`

**Interfaces:**
- Consumes: `readStdin` (Task 7), `addSharedLabel`, `sharedLabel` (Task 9).
- Produces:
  - `export function parsePrInput(text: string): { title: string; body?: string; draft?: boolean; labels?: string[] }`: zod; `title` required and non-empty; output-only keys (`dryRun`, `number`, `url`, `created`, `head`, `base`) and unknown keys ignored; empty or non-JSON → ``expected a JSON document on stdin: { "title": "…", "body": "…" }``.
  - `PrOptions.input?: string`; `PrDeps.readStdin?`, `PrDeps.stdinIsTTY?`.
  - `PrOutcome` gains `title: string; labels: string[]`.
  - `export interface PrDryRun { dryRun: true; title: string; body: string; labels: string[]; draft: boolean; head: string; base: string }`, printed as the one JSON line on a `--dry-run --json` run.

Behaviour: `--input=json` with `--title`, `--body` or `--body-file` → refused; with `stdinIsTTY` → refused at once (Review Focus 4). The JSON body is treated as given text: title through `addSharedLabel` when commits share a label, body through `applyFooter` unless `--no-footer`, `labels` replace `inferLabels(commits)` when present, `draft: true` opens a draft like `--draft`. `--check`, `--no-push`, `--base` unchanged.

- [ ] **Step 1: Write failing tests**:
  - `pr-input.test.ts`: valid body; missing `title` refused; `dryRun`/`number` ignored; `''` refused with the stdin message.
  - `pr.test.ts`: `--input=json` body `{ title: 'my words', labels: ['x'] }` → `createPR` gets the labelled title and labels `['x']`, no `generatePR` call; `--input=json --title t` refused; `stdinIsTTY: true` refused before `readStdin`; `--dry-run --json` prints one line with `dryRun: true`, `title`, `body`, `labels`, `draft`, `head`, `base` and calls neither push nor create; a real `--json` run's line includes `title` and `labels`.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/pr.test.ts src/commands/_shared/pr-input.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the listed changes.
- [ ] **Step 4: Run** the same command plus `pnpm --filter @helmsmith/pritty typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pritty): pr takes a JSON body and prints its dry run as JSON`.

### Task 11: End-to-end through the built CLI

**Files:**
- Modify: `apps/pritty/tests/e2e/helpers.ts` (`runCli` gains `opts.stdin?: string`, written before closing stdin)
- Modify: `apps/pritty/tests/e2e/commit.test.ts`

**Interfaces:**
- Consumes: the CLI from Tasks 4, 7 and 8.

- [ ] **Step 1: Write failing e2e tests** (repo from `makeRepo`, `src/feature.ts` and `src/feature.test.ts` staged, no fake `claude` installed so any model call fails the test):
  - `commit --label wedmodd-23444 --type feat --scope feature --message "greet users" --output=json -- src/feature.ts`, then the same with `--type test --message "cover greeting" -- src/feature.test.ts` → `git log --format=%s` shows `WEDMODD-23444 test(feature): cover greeting` over `WEDMODD-23444 feat(feature): greet users`; nothing left staged.
  - `commit --dry-run --output=json` with a JSON body on stdin, then `commit --input=json --output=json` fed that output → two commits whose subjects equal the dry run's `message`s.
  - a refused call (`--type test` on `src/feature.ts`) → exit 1, stderr has the reason, stdout empty, HEAD unchanged.
- [ ] **Step 2: Build and run** `pnpm --filter @helmsmith/pritty build && pnpm --filter @helmsmith/pritty exec vitest run --config vitest.e2e.config.ts tests/e2e/commit.test.ts`. Expected: PASS (the behaviour exists after Tasks 4–8). A failure points to a gap in the owning task's module: fix it there, with a unit test, and rerun.
- [ ] **Step 3: Commit** `test(pritty): e2e for commits from args and a JSON body`.

### Task 12: Docs and changesets

**Files:**
- Modify: `apps/pritty/SKILL.md`, `apps/pritty/src/commands/_shared/templates.ts` (skill and `/commit`, `/pr` commands), `apps/pritty/README.md` (commit and pr sections, config reference `commitLabels`), `docs/work-lifecycle.md` (line 93, the `pritty commit --json` sentence)
- Test: `apps/pritty/src/commands/_shared/templates.test.ts`
- Create: `.changeset/pritty-agent-commits.md` (`"@helmsmith/pritty": minor`), `.changeset/gitradar-labelled-subjects.md` (`"@helmsmith/gitradar": patch`)

**Interfaces:**
- Consumes: flags and shapes from Tasks 4–10, verbatim.

Content decisions: the skill's anti-pattern "Write your own commit message and pass it to `git commit -m`" becomes guidance to pass `--label --type --scope --message -- <paths>` (one call per commit, code before tests) or a JSON body with `--input=json`; "per-category" wording becomes "per change, per category"; `--json` examples become `--output=json`. README documents the three inputs for commit and pr, `--dry-run`, `--output=json`, the label grammar and normalisation, `commitLabels`, and the PR title form.

- [ ] **Step 1: Write a failing test** in `templates.test.ts`: the `/commit` command and the skill mention `--label`, `--message`, `--input=json` and `--output=json`.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty exec vitest run src/commands/_shared/templates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Update** the docs, templates and changesets.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `docs(pritty): agent commits, JSON input and output, commit labels`.

### Task 13: skoolscout-com commit-msg hook accepts a label

Repository: `/Users/edwincruz/Development/Workspaces/skoolscout/skoolscout-com`, on its own workbrokr effort (the owner starts it). Its commits follow that repo's hook: `chore(<scope>): …`.

**Files:**
- Modify: `.helmsmith/hooks/commit-msg` (`check`)
- Test: `.helmsmith/hooks/commit-msg.test.sh`

**Interfaces:**
- Produces: `check` strips a leading `^[A-Z0-9]+(-[A-Z0-9]+)* ` when what follows matches `^[a-z]+(\([^)]*\))?!?: `, runs today's checks on the rest, and measures length on the whole subject (warn over 72, refuse over 100, as today).

- [ ] **Step 1: Write failing cases** in `commit-msg.test.sh`: `expect accept 'WEDMODD-23444 fix(issue-report): log only exception class'`; `expect accept 'STATUS-LOGGING test(org/global): cover the search'`; `expect refuse '[status] fix(issue-report): x'`; `expect refuse 'WEDMODD-23444 fix(issue-report): Log it'`; `expect refuse 'WEDMODD-23444 fix: no scope'`; a labelled subject of 101 characters → `refuse`.
- [ ] **Step 2: Run** `sh .helmsmith/hooks/commit-msg.test.sh` and `SH=dash sh .helmsmith/hooks/commit-msg.test.sh` if `dash` is installed. Expected: FAIL on the labelled accepts.
- [ ] **Step 3: Implement** the strip in `check`.
- [ ] **Step 4: Run** both again. Expected: PASS, and `.helmsmith/hooks/commit-msg --check 'WEDMODD-23444 fix(issue-report): x'` exits 0.
- [ ] **Step 5: Commit** `chore(platform/tooling): commit-msg hook accepts a leading commit label`. `commitLabels: true` in skoolscout's two pritty config files is a later step, after this is on `develop` and pritty is published (§5.10).

### Task 14: Whole-branch verification (helmsmith)

- [ ] **Step 1: Run** `pnpm --filter @helmsmith/pritty test && pnpm --filter @helmsmith/pritty typecheck`. Expected: all pass.
- [ ] **Step 2: Run** `pnpm --filter @helmsmith/pritty build && pnpm --filter @helmsmith/pritty test:e2e`. Expected: all pass.
- [ ] **Step 3: Run** `pnpm --filter @helmsmith/gitradar exec vitest run && pnpm --filter @helmsmith/gitradar typecheck`. Expected: all pass.
- [ ] **Step 4: Run** `pnpm check`. Expected: no Biome errors.
- [ ] **Step 5:** Report to the owner for `work pr` (helmsmith) and the publish (`make publish-web`, run by the owner).
