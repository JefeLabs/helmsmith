# pritty commit — group by change, then by category (design)

**Status:** draft for owner review, 2026-11-16. Decisions marked *owner* came from the owner; decisions marked *my call* are the author's and open to override (§7).

## 1. Intent

The owner built pritty expecting the AI to organize commits **by change, then by category** (*owner*). A user reported that it does not: `pritty commit` sorts staged files into categories with globs (`src/categorizer.ts`) and makes one commit per category; the model only writes the messages, and `reconcileCommitPlan` (`src/commands/_shared/plan.ts`) throws away any file list it returns. Two unrelated changes staged together therefore share one `app` commit and one `test` commit.

```
staged: auth/login.ts, auth/login.test.ts, billing/invoice.ts, billing/invoice.test.ts

today                              with this design
app   feat: login + invoice        login rate limit   app   feat(auth): rate-limit login
test  test: both                                      test  test(auth): cover the rate limit
                                   invoice rounding   app   fix(billing): round invoice totals
                                                      test  test(billing): cover rounding
```

## 2. Goals, non-goals, anti-goals

**Goals**
- The categorizer still labels every file first, by globs, with no model involved (*owner*).
- The model then groups the files into changes (*owner*), and pritty makes one commit per change per category.
- A change's commits sit together in history, code before its tests and stories, so each commit builds and passes on its own (*my call*, extends today's ordering rule).
- Grouping is a config choice; the old per-category behavior stays available (*owner*, see §7 on the reading of "keep it as a config").

**Non-goals**
- Splitting one file's hunks across changes. A file goes whole into one change (*my call*, the owner did not object).
- Changes to `pritty pr` or `pritty rebase`.
- Letting the model change a file's category.

**Anti-goals**
- The model committing a file that is not staged, a file twice, or a file under another category.
- A commit, inside one change, that adds tests before the code they exercise (red at that commit, breaks bisect).
- A real run committing a different grouping from the one a dry run showed.

## 3. Approaches

1. **One model call, bigger answer** (*owner* picked this). The call that writes the messages also says which files form each change. No extra latency or cost; the grouping comes from the same diff the messages are written from.
2. Two model calls: group first, then write messages. Simpler prompts and room to edit groups before messages, at twice the cost and wait per commit.
3. No model: pair `x.test.ts` with `x.ts` and group by directory. Predictable, but misses changes that cut across folders, which is the case the owner wants the model for.

## 4. Design

**Config.** `commitGrouping: "change" | "category"`, default `"change"` (*my call*: it is what the tool was meant to do). `"category"` sends today's prompt and gets today's plan exactly.

**Prompt** (`generateCommitMessages`, `src/ai.ts`). Still one call, still files listed under `##` category headings, still the redacted diff. With `"change"` the instructions add: group the files into changes, where a change is one logical unit of work; write one entry per change per category; each entry is `{ change, category, message, body?, files }`, where `change` is a short label shared by that change's entries and `files` is a non-empty subset of that category's files; every listed file appears in exactly one entry; list changes in the order they should be committed.

**Plan type.** `CommitMessage` gains `change?: string`.

**Reconcile.** A category the model leaves whole (one entry) gets the categorizer's full file list and the model's list is ignored, exactly as today. Only a category the model **splits** (two or more entries, allowed with `"change"` only) takes membership from the model's `files`, so for those the check is the safety gate. A plan is refused before anything is committed (same as today's "omits categories" error) when:
- an entry names a category the categorizer did not produce (the existing rename pairing still applies first, counting distinct names);
- in a split category, an entry has no `change` label, no files, or a file that is not in that category's staged files;
- in a split category, a file is in two entries, two entries share a `change` label, or a staged file is in no entry;
- with `"category"`, any category appears twice (today's rule).

A plan where no category is split commits exactly what today's pritty commits; only the order can differ, when the model labels changes.

Refusing rather than falling back to per-category commits is *my call*: a silent fallback would commit a grouping nobody was shown. The error says to rerun, or to set `commitGrouping: "category"`.

**Order.** Changes in the order the model first names them (labels compared after trimming; entries with no label form one change); inside a change, code categories in categorizer order, then `test`, then `storybook` (today's `LAST_CATEGORIES`). A split category's files keep the categorizer's order.

**Display and editing.** The plan prints grouped under change headings. The per-commit edit prompt names both: `Edit message for login rate limit · app?`.

**JSON.** Each commit in `--json` output gains `change` (additive; no consumer in the monorepo reads `commit --json` fields today).

**Plan cache.** `planKey` gains `commitGrouping`; cached entries keep `change` and pass through the same reconcile. The version already in the key makes old caches miss after the upgrade.

**Unchanged.** `retypeForBranch` and `applySubjectOverrides` already work per entry. `--scope` applies to every change's commits, which is what the caller asked for.

**Known limit.** The diff in the prompt is capped at 12,000 characters (`PROMPT_INPUT_LIMIT`). Past that, the model groups the remaining files from their names alone.

## 5. Testing

- Reconcile: each refusal rule above; ordering across and inside changes; a one-change plan equals today's output.
- Prompt: `"change"` adds the grouping instructions; `"category"` sends today's prompt unchanged.
- `runCommit` with a fake model returning two changes: four commits, in order, each with only its files.
- E2E with the fake `claude` binary: the same, through the built CLI, plus `--json` carrying `change`.

## 6. Release and docs

pritty minor bump with a changeset. README commit section, `docs/architecture.md`, and `docs/work-lifecycle.md` ("groups staged files by category") updated.

## 7. Calls to check

- **"Keep it as a config"** was read as both: `claude.strictMcpConfig` stays a repository config key (PR #164, README now states what it exposes), and grouping gets its own config key.
- Default `"change"` rather than `"category"`; existing users get the new grouping on upgrade.
- Refuse an invalid grouping instead of falling back.
- Whole files only; no hunk splitting.
- Key name `commitGrouping`.

Left to the builder: exact prompt wording, and whether the change-mode checks extend `reconcileCommitPlan` or sit in a sibling function.
