# pritty commit: group by change, then by category — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pritty commit` makes one commit per change per category: the categorizer labels files, the same model call groups them into changes, and pritty refuses any grouping that is not a clean split of the staged files.

**Architecture:** A new config key `commitGrouping` (`"change"` default, `"category"` = today). The prompt in `generateCommitMessages` asks for a `change` label per entry and lets a category appear in several entries. `reconcileCommitPlan` keeps today's rule for a category the model leaves whole and validates the model's file split for a category it splits, then orders by change. `runCommit` threads the setting through the model path, the plan cache and the output.

**Tech Stack:** TypeScript (ESM), zod 4, vitest, pnpm workspace, Biome.

**Spec:** `docs/superpowers/specs/2026-11-16-pritty-commit-group-by-change-design.md`

All paths below are relative to `apps/pritty/` unless they start with `docs/` or `.changeset/` (repo root). Run vitest from `apps/pritty/`; run Biome from the repo root.

## Global Constraints

- Config key `commitGrouping: "change" | "category"`, default `"change"`.
- `CommitMessage` gains `change?: string`; nothing else in its shape changes.
- One model call per `pritty commit`, as today.
- A category the model leaves whole always commits the categorizer's full file list, whatever `files` the model returned.
- Refusals throw before any `git commit` runs; every change-mode refusal message contains `commitGrouping` (the spec: "The error says to rerun, or to set `commitGrouping: "category"`").
- Inside a change: code categories in categorizer order, then `test`, then `storybook`.
- `--json` adds `change` to a commit only when the plan entry has one.
- Release: `@helmsmith/pritty` minor changeset.

## Review Focus

1. **Labels that differ only by surrounding spaces** (`"login "` vs `"login"`): one change, not two. Test in Task 1.
2. **A path the model spells differently** (`./src/a.ts`, wrong case) inside a split: refused, naming the path, never committed. Test in Task 1.
3. **A split that forgets one staged file**: refused, naming the file, nothing committed. Test in Task 1.
4. **A plan cached under `"category"` reused after switching to `"change"`**: a cache miss, the model is asked again. Test in Task 3.
5. **Editing a split commit's message interactively**: the edit keeps its `change` and its files. Test in Task 3.

---

### Task 1: Config key and change-aware reconcile

**Files:**
- Modify: `src/config.ts` (add `CommitGroupingSchema`, `commitGrouping` to `ConfigSchema`)
- Modify: `src/ai.ts:64-69` (`CommitMessage` gains `change?: string`)
- Modify: `src/commands/_shared/plan.ts` (`reconcileCommitPlan`, `pairRenamedCategory`)
- Test: `src/config.test.ts`, `src/commands/_shared/plan.test.ts`

**Interfaces:**
- Produces: `export const CommitGroupingSchema = z.enum(['change', 'category'])` and `export type CommitGrouping = z.infer<typeof CommitGroupingSchema>` in `src/config.ts`; `Config['commitGrouping']`.
- Produces: `reconcileCommitPlan(plan: readonly CommitMessage[], grouped: CategorizedFiles, onRename?: (from: string, to: string) => void, grouping: CommitGrouping = 'category'): CommitMessage[]`. The default stays `'category'` so existing callers and tests keep today's behavior until Task 3 passes the config value.

- [ ] **Step 1: Write the failing config tests** in `src/config.test.ts`, new `describe('commitGrouping')`:
  - `ConfigSchema.parse({}).commitGrouping` is `'change'`
  - `ConfigSchema.parse({ commitGrouping: 'category' }).commitGrouping` is `'category'`
  - `ConfigSchema.parse({ commitGrouping: 'file' })` throws

- [ ] **Step 2: Write the failing reconcile tests** in `src/commands/_shared/plan.test.ts`, new `describe('reconcileCommitPlan with grouping change')`, using
  `const g = { app: ['src/a.ts', 'src/b.ts'], test: ['src/a.test.ts', 'src/b.test.ts'], storybook: [], unknown: [] }`:
  - `'splits a category into one commit per change, ordered by change, code before tests'`: entries `{change:'b', category:'test', files:['src/b.test.ts']}`, `{change:'a', category:'app', files:['src/a.ts']}`, `{change:'b', category:'app', files:['src/b.ts']}`, `{change:'a', category:'test', files:['src/a.test.ts']}` (messages `m1`..`m4`) → result `[change, category, files]` equals `[['b','app',['src/b.ts']], ['b','test',['src/b.test.ts']], ['a','app',['src/a.ts']], ['a','test',['src/a.test.ts']]]`.
  - `'gives a category the model left whole the categorizer’s full list'`: `{change:'a', category:'app', files:['src/a.ts','secret.env']}` + two split `test` entries → the `app` entry's files are `['src/a.ts','src/b.ts']`.
  - `'treats labels that differ only by surrounding spaces as one change'`: changes `'login '` and `'login'` on `app` and `test` (each whole) → both entries adjacent, `app` first. (Review Focus 1)
  - `'refuses a split naming a file that is not staged in that category'`: split `app` with files `['./src/a.ts']` and `['src/b.ts']` → `toThrow(/\.\/src\/a\.ts[\s\S]*commitGrouping/)`. Same with `['src/a.test.ts']` under `app` → throws naming `src/a.test.ts`. (Review Focus 2)
  - `'refuses a split that leaves a staged file out'`: with `g3 = { app: ['src/a.ts', 'src/b.ts', 'src/c.ts'], test: [] }`, split `app` into `['src/a.ts']` (change `a`) and `['src/b.ts']` (change `b`) → `toThrow(/src\/c\.ts[\s\S]*commitGrouping/)`. (Review Focus 3)
  - `'refuses a split with an empty entry or a file in two entries'`: `['src/a.ts', 'src/b.ts']` + `[]` → throws `/commitGrouping/`; `['src/a.ts', 'src/b.ts']` + `['src/a.ts']` → throws `/src\/a\.ts/`.
  - `'refuses a split entry with no change label, or two entries sharing a label'`: each throws `/commitGrouping/`.
  - `'still refuses a split category when grouping is category'`: the first test's entries with grouping `'category'` → `toThrow(/more than once/)`.
  - `'pairs a renamed category once even when the model split it'`: `g2 = { app: ['src/a.ts', 'src/b.ts'], test: [], unknown: [] }`, entries `{change:'a', category:'feature', files:['src/a.ts']}`, `{change:'b', category:'feature', files:['src/b.ts']}` → onRename called once with `['feature','app']`, two `app` commits.
  - `'without change labels commits what today’s plan commits'`: the existing first test's input with grouping `'change'` → same output as with `'category'`.

- [ ] **Step 3: Run them to verify they fail**
  Run: `npx vitest run src/config.test.ts src/commands/_shared/plan.test.ts`
  Expected: the new tests FAIL (unknown key / too many arguments ignored → wrong output); existing tests PASS.

- [ ] **Step 4: Implement** the schema and `change?: string`, then extend `reconcileCommitPlan`:
  1. `pairRenamedCategory`: count **distinct** stranger names (`new Set(strangers.map(s => s.category))`), and rename every entry with that name.
  2. Group entries by category (after pairing). Unknown category → today's error. Category with no staged files → drop its entries. Category with one entry → that entry with `files: [...grouped[cat]]`.
  3. Category with two or more entries: with `'category'` → today's `more than once` error. With `'change'` → each entry needs a trimmed non-empty `change`, a non-empty `files` list, every file in `grouped[cat]`, no file in two entries, no label twice, and the union must equal `grouped[cat]`; each entry's `files` is `grouped[cat].filter(f => entryFiles.has(f))` (categorizer order). Errors: `AI plan does not split ${cat} cleanly: ${detail}. Run pritty commit again, or set "commitGrouping": "category".`
  4. Missing categories → today's error.
  5. Order: key = `change?.trim() ?? ''`; change rank = index of first appearance in the model's list; inside a change, today's `rank` (`LAST_CATEGORIES` then categorizer position). Store the trimmed label on the entry.

- [ ] **Step 5: Run the tests to verify they pass**
  Run: `npx vitest run src/config.test.ts src/commands/_shared/plan.test.ts`
  Expected: all PASS, including every pre-existing `reconcileCommitPlan` test.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/pritty/src/config.ts apps/pritty/src/config.test.ts apps/pritty/src/ai.ts apps/pritty/src/commands/_shared/plan.ts apps/pritty/src/commands/_shared/plan.test.ts
  git commit -m "feat(pritty): reconcile a commit plan that splits categories by change"
  ```

### Task 2: Prompt asks the model to group by change

**Files:**
- Modify: `src/ai.ts` (`generateCommitMessages` system prompt, around lines 275-287)
- Test: `src/ai.prompt.test.ts`

**Interfaces:**
- Consumes: `Config['commitGrouping']` (Task 1).
- Produces: no signature change; `generateCommitMessages` returns entries that may carry `change`.

- [ ] **Step 1: Write the failing tests** in `src/ai.prompt.test.ts` under `describe('generateCommitMessages')`, using the existing `answer()`/`sent()` helpers:
  - `'asks the model to group files into changes and label each entry'`: default config → `sent().system` matches `/group the files into changes/i`, contains `` `change` `` and matches `/exactly one entry/i`; does **not** match `/one commit message per file category/i`.
  - `'keeps today’s per-category prompt when commitGrouping is category'`: `ConfigSchema.parse({ provider: 'claude', commitGrouping: 'category' })` → system matches `/one commit message per file category/i` and does not contain `` `change` ``.
  - `'passes the change label through'`: answer `[{ change: 'login', category: 'app', message: 'feat: x', files: ['src/a.ts'] }]` → returned plan's `[0].change` is `'login'`.

- [ ] **Step 2: Run to verify they fail**
  Run: `npx vitest run src/ai.prompt.test.ts`
  Expected: the first two new tests FAIL; the third may already pass (parsing is untyped). Existing tests PASS.

- [ ] **Step 3: Implement.** With `'category'`, the system prompt is byte-for-byte today's. With `'change'`, replace the `Produce one commit message per file category.` sentence and the key list with instructions that say: group the files into changes (one logical unit of work each); write one entry per change per category; keys `change` (a short label shared by all of that change's entries), `category`, `message`, `body` (optional), `files` (that change's files from that category's `##` list); every listed file appears in exactly one entry; list changes in the order they should be committed. Keep the category-name-exactly, no-fences, branch and ticket lines unchanged.

- [ ] **Step 4: Run to verify they pass**
  Run: `npx vitest run src/ai.prompt.test.ts src/ai.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/pritty/src/ai.ts apps/pritty/src/ai.prompt.test.ts
  git commit -m "feat(pritty): the commit prompt asks the model to group files into changes"
  ```

### Task 3: runCommit uses the grouping end to end

**Files:**
- Modify: `src/commands/commit.ts` (both `reconcileCommitPlan` calls, `planKey` call, plan display, edit prompt, `CommitOutcome`, commit loop output)
- Modify: `src/commands/_shared/plan-cache.ts` (`planKey` parts, `isCommitMessage`)
- Test: `src/commands/commit.test.ts`, `src/commands/_shared/plan-cache.test.ts`

**Interfaces:**
- Consumes: `reconcileCommitPlan(..., grouping)` and `Config['commitGrouping']` (Task 1).
- Produces: `CommitOutcome['commits'][n]` gains `change?: string`; `planKey(parts: { stagedState: string; branch: string; commitStyle: string; commitGrouping: string; categories: Record<string, string[]>; version: string }): string`.

- [ ] **Step 1: Write the failing tests.**
  - `plan-cache.test.ts` `planKey`: add `commitGrouping: 'change'` to `parts` and `{ commitGrouping: 'category' }` to the list of changes that must change the key. `filePlanCache`: a written plan entry with `change: 'a'` reads back with it; an entry with `change: 3` makes the file a miss.
  - `commit.test.ts`, new `describe('runCommit grouping by change')` with `staged: ['src/a.ts', 'src/b.ts', 'src/a.test.ts', 'src/b.test.ts']` and an `answer` returning the Task 1 split (changes `b` then `a`):
    - `'commits each change’s code then its tests, change by change, each with only its files'`: `runCommit({ json: true }, f.deps)` → `f.committed.map(c => c.files)` equals `[['src/b.ts'], ['src/b.test.ts'], ['src/a.ts'], ['src/a.test.ts']]`; the JSON line's commits carry `change` `['b','b','a','a']`.
    - `'refuses a bad split and commits nothing'`: answer leaves out `src/b.test.ts` → rejects `/commitGrouping/`, `f.calls` has no `'commit'`.
    - `'with commitGrouping category, sends today’s plan and refuses a split'`: `config: { commitGrouping: 'category' }` and the split answer → rejects `/more than once/`.
    - `'does not reuse a plan kept under the other grouping'` (Review Focus 4): one `memoryCache()` shared by two `fakes()`; `f1` (`commitGrouping: 'category'`, per-category answer) runs `{ json: true, dryRun: true }`, then `f2` (default config, split answer) runs `{ json: true }` → `f2.calls` contains `'generate'` and `f2.committed` has four commits. (Without the key change, `f2` would reuse `f1`'s plan.)
    - `'keeps a split commit’s change and files when its message is edited'` (Review Focus 5): non-json run, `prompts.confirm` returns true, `prompts.editor` returns `'feat: edited'` → `f.committed[0]` starts with `feat: edited` and has files `['src/b.ts']`, and the returned outcome's `commits[0].change` is `'b'`.
    - `'labels edit prompts with the change and category'`: record `confirm` messages → contains `'Edit message for b · app?'`.

- [ ] **Step 2: Run to verify they fail**
  Run: `npx vitest run src/commands/commit.test.ts src/commands/_shared/plan-cache.test.ts`
  Expected: new tests FAIL; existing tests PASS.

- [ ] **Step 3: Implement.** Pass `config.commitGrouping` to both `reconcileCommitPlan` calls and into `planKey`. `isCommitMessage` accepts `change` as undefined or string. Label helper in `commit.ts`: `const label = (c: CommitMessage) => (c.change ? `${c.change} · ${c.category}` : c.category)`, used in the edit prompt (`Edit message for ${label(c)}?`, `Editing ${label(c)} commit message`), the `✓ committed` line and the failure line. The plan display prints a change heading line (`chalk.cyan(change)`) whenever the change differs from the previous entry's and entries have labels; commits keep today's two-line format under it. Spread `...(c.change ? { change: c.change } : {})` into each dry-run and real-run outcome commit.

- [ ] **Step 4: Run the whole unit suite**
  Run: `npx vitest run` then `pnpm -s typecheck`
  Expected: all PASS; typecheck exits 0.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/pritty/src/commands/commit.ts apps/pritty/src/commands/commit.test.ts apps/pritty/src/commands/_shared/plan-cache.ts apps/pritty/src/commands/_shared/plan-cache.test.ts
  git commit -m "feat(pritty): pritty commit makes one commit per change per category"
  ```

### Task 4: E2E, docs and changeset

**Files:**
- Test: `tests/e2e/commit.test.ts`
- Modify: `README.md` (status table line 27, `--json` table line 207, the commit section around lines 223-260, config example lines 69-82), `docs/architecture.md` (schema block), `docs/work-lifecycle.md:93` (repo root)
- Create: `.changeset/pritty-commit-group-by-change.md` (repo root)

**Interfaces:**
- Consumes: everything above, through the built CLI.

- [ ] **Step 1: Write the failing e2e test** in `tests/e2e/commit.test.ts`: `'splits two changes into a commit per change per category'`. Repo from `makeRepo(sb, { config: { provider: 'claude' } })`; stage `src/a.ts`, `src/a.test.ts`, `src/b.ts`, `src/b.test.ts`; `installFakeClaude(sb).answer(...)` with the Task 3 split; `runCli(sb, repo, ['commit', '--json'])` → exit 0, the JSON line's commits have `change` `['b','b','a','a']` and files as in Task 3, `git log --format=%s -4` lists the four subjects newest-first, and `git status --porcelain` is empty.

- [ ] **Step 2: Build and run it**
  Run: `pnpm -s build && pnpm -s test:e2e`
  Expected: the new test PASSES now that Tasks 1-3 are in (it fails on a tree without them); every e2e test PASSES.

- [ ] **Step 3: Docs.** README: status row says "per-change, per-category AI commit messages"; `--json` row shows `commits: [{ change?, category, message, files, sha }]`; the commit section gains a short "Grouping by change" paragraph with the before/after sketch from the spec §1, the refusal rules in one list, and `"commitGrouping": "category"` for today's behavior; add `"commitGrouping": "change"` to the config example. `docs/architecture.md`: `commitGrouping: "change" | "category", // default "change"`. `docs/work-lifecycle.md:93`: "groups staged files by category" → "groups staged files by change, then by category".

- [ ] **Step 4: Changeset** `.changeset/pritty-commit-group-by-change.md`:
  ```markdown
  ---
  "@helmsmith/pritty": minor
  ---

  `pritty commit` now groups staged files by change, then by category: the same model call that writes the messages says which files form each change, and pritty makes one commit per change per category, code before tests within each change. A grouping that is not a clean split of the staged files is refused before anything is committed. `"commitGrouping": "category"` keeps the old one-commit-per-category behavior. `--json` commits carry a `change` label when the model gave one.
  ```

- [ ] **Step 5: Verify**
  Run (repo root): `npx biome check apps/pritty .changeset docs` then (in `apps/pritty`) `npx vitest run && pnpm -s typecheck`
  Expected: Biome reports no errors; all tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**
  ```bash
  git add apps/pritty/tests/e2e/commit.test.ts apps/pritty/README.md apps/pritty/docs/architecture.md docs/work-lifecycle.md .changeset/pritty-commit-group-by-change.md
  git commit -m "docs(pritty): document grouping commits by change; e2e and changeset"
  ```
