# gittyup — whole-file conflict resolution, a repo-state guard, resumable cherry-pick, honest PRs, and one auth path (design)

**Status:** draft from the 2026-10-19 critical review; awaiting owner approval. Every problem below was reproduced against a throwaway git repo or the built CLI before it was written down.
**Home:** `apps/gittyup` (`@helmsmith/gittyup`, 0.1.0 → 0.2.0).
**Series:** one spec, nine slices. Each slice in §3 is sized to be one PR and lists its own tests and acceptance criteria. Slices 3.1 to 3.3 are blocking: until they land, `merge` and `pick` can lose user data and must be treated as unsafe.
**Standing constraints:** `docs/toolbox-conventions.md` (co-located unit tests, `tests/e2e/` spawns the built CLI, every app implements every script). Node 24, Bun launcher, git ≥ 2.38 (for `merge-tree --write-tree`, already assumed by `compare`).

---

## 1. Problem

Gittyup's manifest, dashboard, `find`, and tagging code work. The orchestration core does not. Each gap is stated against the code on `main` (c984d3c), with the reproduction that confirmed it.

1. **Resolution writes a fragment as the whole file.** `parseConflictMarkers` (`src/core/git-operations.ts:214`) concatenates only the text between `<<<<<<<`/`=======`/`>>>>>>>` and discards every line outside a hunk. That fragment is what `ConflictFile.oursContent`/`theirsContent` hold, what the AI prompt receives, what `manualEdit` opens as the editor default, and what "Accept as-is" and AI auto write back through `resolveFile` (`src/core/conflict-resolver.ts:148,170,251`). Reproduced: an 8-line file with a one-line conflict yields `oursContent: "line4-ours"`. Accepting any AI or manual resolution deletes the other seven lines and stages the result.

2. **Suggest mode writes prose.** The suggest prompt asks the model to "explain your reasoning briefly, then output the merged file contents in a code block" (`src/core/orchestrator.ts:296`). "Accept as-is" writes the whole reply, explanation included, into the file.

3. **Multi-commit cherry-pick stops at the first conflict and reports success.** `cherryPick` returns on the first conflicted SHA (`git-operations.ts:159`). After the resolver commits, nothing applies the remaining SHAs, and the result reads "Resolved and applied N commits" (`orchestrator.ts:194`). Reproduced: picking `[c1, c2]` where `c1` conflicts leaves `c2` unapplied with a green result row. The resolution also commits via `git commit -m "resolve: …"` (`git-operations.ts:258`), discarding the picked commit's message.

4. **Stash is popped onto the wrong branch and the repo is never restored.** `executeMerge`/`executeCherryPick` stash on whatever branch is checked out, `checkout` the target inside `merge()`/`cherryPick()`, then pop (`orchestrator.ts:70-100`). Reproduced: uncommitted edits on `main` reappear on `develop`. The repo is left on the target branch.

5. **Escalation leaves the repo mid-merge.** `createConflictBranch` is `git checkout -b` with no commit (`git-operations.ts:196`). The new branch points at the same commit as the target, the unmerged index follows it, the subsequent stash pop fails and is swallowed, and the prefix is hardcoded, ignoring `settings.conflict_branch_prefix` (`conflict-resolver.ts:112`).

6. **`--pr` can never succeed after a clean merge, and failures are invisible.** `attachPRs` uses `head = conflictBranch || targetBranch` and `base = targetBranch` (`orchestrator.ts:243`), so a clean merge asks GitHub for a PR from a branch into itself. GitHub answers 422; `createPR` treats every 422 as "already exists" (`src/github/client.ts:51`), `findExistingPR` returns null, and the orchestrator only reads `pr.url`, never `pr.status`/`pr.message`. The PR template is substituted with single-occurrence `String.replace` on a default template that uses `{{operation}}` twice, and `{{commit_count}}` is the literal `N/A`.

7. **`config --ai <bad>` bricks every later command.** `updateSettings` writes the raw string (`src/commands/config.ts:15`). Reproduced: `config --ai turbo` prints a success tick; `repo list` then dies with a raw ZodError stack. `merge --ai` and `pick --ai` cast without validation too.

8. **Silent fetch.** Pre-operation fetch wraps every repo in an empty `catch {}` and the spinner always says "Fetch complete" (`orchestrator.ts:55`). `status --fetch` discards `fetchAll`'s result array (`src/commands/status.ts:23`).

9. **Two auth layers, one wired, both writing `auth.json`.** The orchestrator uses `resolveGitHubToken`/`callCopilot` from `src/auth/token-manager.ts`, which reads the legacy flat `auth.json`. `src/auth/providers/{anthropic,openai,copilot}.ts`, `provider-registry.ts`, `call-ai.ts`, and `oauth-pkce.ts` (about 1,300 lines) are imported by nothing outside `src/auth/`. `readAuthFile` auto-migrates the flat file to a nested shape that `readAuthCredentials` cannot parse. Wiring either side today corrupts the other's credentials.

10. **The Copilot login token is used for the GitHub API.** The device flow requests scope `read:user` (`src/auth/device-flow.ts:26`). `requireGitHubToken` prefers that token over `gh auth token` and `git credential fill`. After `auth login`, PR creation and private-repo listing use a token that can do neither. `GH_TOKEN` is documented in the README and honored only by `connect`.

11. **Packaging omits what `init` needs, and the installed commands call a binary that does not exist.** `package.json#files` ships `bin`, `dist`, `branding.yaml`; `getContextDir` (`src/context/index.ts:68`) looks for `src/context`, which is not in the tarball. The bundled command files invoke `agentx-gittyup`; the bin is `gittyup`. The `codex` installer overwrites an existing `AGENTS.md` wholesale when it already contains the gittyup heading (`src/context/index.ts:280`).

12. **Dashboards read stale or wrong refs.** `compare --fetch` fetches `origin/<b>` then inspects local `<b>`; `getBranchState` assumes the tracking remote is `origin` regardless of `repo.remote` (`git-operations.ts:36`); `getRepoOwner` truncates repo names containing a dot (`client.ts:126`); `getSideInfo` walks 9,999 commits per side per repo to compute a total that is not a diff.

13. **No test touches any of the above.** Eight tests exist, all on Zod defaults. `test:integration` and `test:e2e` point at directories that do not exist, so `vitest run tests/e2e/` exits non-zero on "no test files".

---

## 2. Goals and non-goals

**Goals**

- A resolution never writes less than a whole file, never writes conflict markers, and never writes model prose.
- Every `merge`/`pick` invocation returns the repo to the branch and working tree it started on, or says exactly what it could not restore.
- A cherry-pick of N commits applies N commits or reports which ones it did not.
- Every failure the user would want to know about (fetch, push, PR) is printed, not swallowed.
- One auth model, one `auth.json` shape, and the right token for each job.
- The npm tarball runs `init` end to end.
- A test harness that builds throwaway git repos so the above can be asserted, not inspected.

**Non-goals**

- No new providers (Anthropic/OpenAI). The dead layer is deleted, not finished. Re-adding it is its own spec.
- No TUI rewrite. The inquirer prompts stay.
- No change to the manifest schema except validation. Existing `gittyup.yaml` files keep working.
- No decision here on whether to keep borrowing VS Code's Copilot client ID (§8, open).

---

## 3. Design

### 3.1 Whole-file conflict resolution (fixes 1, 2)

**Model.** `ConflictFile` becomes:

```ts
interface ConflictHunk { ours: string; theirs: string; base?: string }
interface ConflictFile {
  path: string;
  /** the file as it sits in the working tree, markers included */
  markedContent: string;
  /** full file from the index stages; undefined when the side deleted the file */
  ours?: string;    // git show :2:<path>
  theirs?: string;  // git show :3:<path>
  base?: string;    // git show :1:<path>
  hunks: ConflictHunk[];
}
```

`getConflictedFiles` reads stages 1–3 with `git show :N:<path>` and keeps `parseConflictMarkers` only to build `hunks` for the preview. A missing stage (add/add, delete/modify) is `undefined`, never `''`.

**Writes go through one gate.** `GitOperations.resolveFile(path, content)` is replaced by `applyResolution(path, content)` which refuses when `content` matches `/^(<{7}|={7}|>{7})/m`, or is empty while neither side was empty, or contains no newline when `ours` and `theirs` both exceed one line. Refusal is an error the resolver shows; the file is untouched and unstaged. This is the only path that writes a resolved file.

**Preview** shows each hunk (first 8 lines per side, `n/N` counter). "View full conflict" prints `markedContent`.

**Manual edit** opens `markedContent` (markers in place), not a fragment. After the editor closes, the gate rejects remaining markers and offers to reopen.

**AI auto** sends `ours`, `theirs`, `base` (full files) and `markedContent`, asks for the complete merged file and nothing else, strips one outer fence if present, then runs the gate. Before staging, print a `diff --stat`-style line (lines added/removed against `ours`) and require confirmation unless `--yes`. A rejected output falls back to the menu, as now.

**AI suggest** asks for a short rationale **followed by** the merged file in a single fenced block. The resolver extracts the **last** fenced block; the rationale is displayed, the block is what "Accept as-is" writes (through the gate). No block means "AI did not return a usable suggestion".

**Model choice.** `settings.ai_model` (new, optional, default `gpt-4o`) replaces the hardcoded literal in `createAiResolver`. `auth models` already lists what the account can use.

**Tests** (`src/core/git-operations.test.ts`, `src/core/conflict-resolver.test.ts`, temp repos via the harness in §7):

- 8-line file, one-line conflict: `ours` and `theirs` are 8 lines; `hunks[0]` is the one-line pair.
- Two hunks in one file: `hunks.length === 2`, `markedContent` round-trips.
- delete/modify: the deleted side is `undefined`; "keep theirs" when theirs is deleted removes the file (`git rm`).
- Gate rejects: markers, empty-when-non-empty, a reply that is only a sentence.
- Suggest extraction: prose + one block → block; prose + two blocks → last; prose only → null.

**Acceptance.** Running `merge` on the reproduction repo and accepting an AI/manual resolution leaves `f.txt` with all 8 lines and no markers.

### 3.2 Repo operation guard (fixes 4, 5-part, 8)

One helper owns branch/stash state for a repo during an operation:

```ts
async withRepoGuard<T>(git, label, fn: () => Promise<T>): Promise<T>
```

Sequence:

1. **Refuse to start** if `git rev-parse -q --verify MERGE_HEAD` or `CHERRY_PICK_HEAD` succeeds, or `git status --porcelain` shows `UU`/`AA`/`DU` entries. Message names the repo and the state and suggests `git merge --abort` / `cherry-pick --abort`.
2. Record `startBranch` (`git symbolic-ref --short HEAD`; detached HEAD → record the SHA and restore with `checkout <sha>`).
3. `git stash push --include-untracked -m "gittyup: <label>"` if the tree is dirty; record whether a stash was created and its ref (`stash@{0}` immediately after push).
4. Run `fn`.
5. **Always** (finally): checkout `startBranch`; if that fails (because `fn` left the repo mid-operation and the user chose "leave as-is"), do **not** pop. Print the branch and the stash ref so nothing is lost.
6. If restored and a stash was created, `stash pop`. If the pop conflicts, leave the stash in place and print the ref.

The orchestrator's inline `stash()`/`stashPop()` calls and the empty catches are removed; `merge()`/`cherryPick()` no longer call `checkout` themselves — the guard checks out the target after step 3 and the operation runs on it.

**Fetch** becomes a reported step: `fetchAll` results are rendered per repo (`✓ fetched` / `✗ <error>`); a failed fetch marks that repo's row `skipped` with the error unless `--no-fetch`. The same rendering serves `status --fetch` and `compare --fetch`.

**Tests.** Dirty on `main`, operate on `develop`: afterwards `HEAD` is `main`, the dirty edit is on `main`, `git stash list` is empty. Operation leaves repo mid-merge: `HEAD` stays on the target branch, the stash is still listed, and the printed message names it. Refusal when `MERGE_HEAD` exists.

### 3.3 Resumable cherry-pick (fixes 3)

`cherryPick(commits, target)` becomes a loop that the orchestrator drives one SHA at a time:

- On a conflict at `commits[i]`, run the resolver. On `resolved`, finish with `git cherry-pick --continue` (keeps the original author and message; the resolver's `commitResolution` is used only for merges). Then continue with `commits[i+1..]`, each of which may conflict again.
- On `abort`, `git cherry-pick --abort` then `git reset --hard <sha-before-first-pick>` so partially applied picks are undone too; row status `error`, message "aborted after k/N".
- On `leave`/`escalate`, stop; message "k/N applied, stopped at <sha>".
- The row message always reads `applied k/N`.

**Per-repo SHAs.** `-c <shas>` with `--group` is refused: "commit SHAs are repo-specific; use --repo, or --interactive to choose per repo". With `--repo` it works as today.

**Tests.** `[c1(conflict), c2]`: after resolving `c1`, `g.txt` from `c2` exists and the log shows both original messages. `[c1(conflict), c2(conflict)]`: two resolver sessions. Abort after `c1` applied cleanly and `c2` conflicting: `HEAD` equals the pre-pick SHA.

### 3.4 Escalation that survives (fixes 5)

"Escalate" now produces a branch someone can pick up later, and leaves the target branch untouched:

1. `git checkout -b <settings.conflict_branch_prefix>/<repo>-<target>-<timestamp>` (verified to work with an unmerged index).
2. `git add -A` and commit **with the markers in place**. The message lists the operation, source, target, and the still-conflicted paths. For a merge this is a merge commit; for a cherry-pick it is `cherry-pick --continue` after `add -A` (markers committed, sequencer cleared).
3. If `--push`, push the branch with upstream.
4. The guard (§3.2) restores the start branch; the target branch has no new commits.

The result row reads `escalated → <branch>` and, with `--pr`, the PR is opened from that branch into the target (§3.5). The commit body carries a `gittyup-escalation: v1` trailer so a future `gittyup resume` can find it; that command is out of scope here.

**Tests.** After escalate: target branch `HEAD` unchanged; escalation branch has one commit whose tree contains `<<<<<<<`; `git status` on the start branch is clean; `MERGE_HEAD` absent.

### 3.5 Honest PR creation (fixes 6)

- `attachPRs` runs only when `head !== base`. That is true for escalation branches and for the new **`--branch <name>`** option on `merge` and `pick`: the operation runs on a branch cut from the target (`<name>` or `gittyup/<op>-<source>-<target>-<date>` when `--branch` is given without a value), `--push` pushes it, `--pr` opens `<name> → target`. Without `--branch`, `--pr` is refused up front with a one-line explanation.
- Template substitution uses `replaceAll` for every placeholder. `{{commit_count}}` is `git rev-list --count base..head`.
- `createPR` on 422 calls `findExistingPR`; if none, it returns `status: 'error'` with GitHub's `message` (and the first `errors[].message` when present). The orchestrator renders `status: 'error'` rows in yellow with that message. Nothing about a PR is ever swallowed.
- `getRepoOwner` becomes `parseGitHubRemote(url)` handling `https://github.com/o/r.git`, `https://github.com/o/r`, `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git`, and repo names with dots; it is synchronous and unit-tested.

**Tests.** Template with two `{{operation}}` → both replaced. 422 with no existing PR → error row with message. `parseGitHubRemote` table test.

### 3.6 Validated config and readable manifest errors (fixes 7)

- `config --ai`, `merge --ai`, `pick --ai` parse through `AiModeSchema.safeParse` and exit 1 with "ai mode must be one of auto, suggest, manual" on failure. Nothing is written.
- `ManifestManager.save()` runs `ManifestSchema.parse` on the object before `yaml.dump`; an invalid manifest cannot be written by any code path.
- `ManifestManager.load()` catches `ZodError` and rethrows `ManifestError` with the file path and each issue as `<path>: <message>`. `cli.ts` catches `ManifestError` and prints it without a stack. The e2e test asserts the exit code and the first line.

### 3.7 One auth path (fixes 9, 10)

**Delete** `src/auth/providers/`, `provider.ts`, `provider-registry.ts`, `call-ai.ts`, `oauth-pkce.ts`, and the multi-provider schemas (`AuthFileSchema`, `OAuthCredentialsSchema`, `CopilotCredentialsSchema`) from `types.ts`. `auth.json` keeps the flat shape it has today. Remove the "Anthropic/OpenAI providers are implemented" paragraphs from `docs/overview.md`.

**Split the cascade by purpose:**

| Purpose | Function | Order |
|---|---|---|
| Copilot chat | `resolveCopilotToken()` | `COPILOT_GITHUB_TOKEN` → `auth.json` |
| GitHub REST (octokit) | `resolveGitHubApiToken()` | `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token` → `git credential fill` |

The Copilot OAuth token is never offered to octokit. `GitHubClient.create()` uses `resolveGitHubApiToken()`; the AI resolver uses `resolveCopilotToken()`. `TokenSource.source` reports the real source (`gh-cli`, `git-credential`), not `auth.json`. `connect` and `auth status` both render both rows. `config --show` shows both. README's auth section is rewritten from this table.

**Tests.** With `GITHUB_TOKEN` unset and `auth.json` present, `resolveGitHubApiToken` does not return the auth.json token. `GH_TOKEN` is honored.

### 3.8 Packaging and context install (fixes 11)

- tsup copies `src/context/**/*.md` to `dist/context/` (`publicDir` or an `onSuccess` copy). `getContextDir` checks `dist/context` first. `npm pack --dry-run` must list `dist/context/agents/release-coordinator.md`; an e2e test asserts it.
- The bundled command files and `release-coordinator.md` use `gittyup` (derived from `APP_NAME`, which `rebrand` already rewrites). `CLI_BIN_NAME` is deleted; `branding.ts` and `rebrand.ts` drop `cliBinName`.
- `codex` install writes between `<!-- gittyup:start -->` / `<!-- gittyup:end -->` markers: replace the marked region if present, append otherwise, never truncate the rest of `AGENTS.md`.
- Dead `src/ui/index.ts` re-exports and the `prepublishOnly` npm script (pnpm workspace) are tidied in the same PR.

### 3.9 Dashboard and compare correctness (fixes 12)

- `compare` resolves each side to `<repo.remote>/<branch>` when `--fetch` is given or when the local branch does not exist; the column header shows which ref was used.
- `getBranchState` tracks `<repo.remote>/<branch>` and reads the upstream from `git rev-parse --abbrev-ref <branch>@{upstream}` when set.
- `commitCount` becomes two numbers from one `rev-list --left-right --count left...right`: commits only on left, commits only on right. The column is renamed `ONLY HERE`.
- `checkConflicts` distinguishes "merge-tree reported conflicts" (exit 1) from "merge-tree failed" (exit ≥ 2, e.g. unknown ref): the latter is an error row, not a guessed boolean.
- `CliCache.printCacheNotice` uses the instance TTL, not the literal 300.

### 3.10 Test harness (fixes 13)

`src/test/git-fixture.ts` exports `makeRepo(spec)` that builds a temp repo from a declarative list of commits per branch (file → content), returns the path, and is cleaned in `afterEach`. All unit tests in §3.1–3.9 use it. `tests/e2e/` gains `cli.test.ts` spawning `bin/gittyup.mjs` against a temp manifest for: `config --ai bad` exit code, `init` in a fresh dir, `merge` with `--no-fetch` on a fixture with one clean and one conflicting repo answering prompts via stdin. Remove the `test:integration` script or create the directory; `vitest.config.ts` sets `passWithNoTests: false` so an empty directory is a failure, not a pass.

---

## 4. Alternatives considered

- **Finish the provider layer instead of deleting it.** Rejected for this spec: no caller exists, `auth login` only knows Copilot, and the migration trap is live today. Deletion is the smallest change that removes the hazard; a provider seam can return with a caller.
- **Commit conflict markers on escalation vs. store the merge state out of band** (patch files under `~/.agentx/gittyup/escalations/`). Committing markers is the convention most teams already recognize (`git grep '<<<<<<<'`), survives machine changes, and makes `--pr` meaningful. Chosen.
- **Replay the AI's answer as a 3-way merge (`git merge-file`) instead of whole-file output.** More robust against the model truncating a long file, but the model would have to emit per-hunk resolutions aligned to git's hunks, which it cannot do reliably. Whole-file plus the gate and the diff-stat confirmation is chosen; a hunk-wise mode can follow.
- **Keep `--pr` after a plain merge by opening a PR from target to prod.** That is a different workflow (promotion), already served by `pick`. Refusing with an explanation is honest; `--branch` gives the review workflow a real home.

---

## 5. Files affected

| Slice | Files |
|---|---|
| 3.1 | `src/core/git-operations.ts`, `src/core/conflict-resolver.ts`, `src/core/orchestrator.ts` (prompts), `src/config/schema.ts` (`ConflictFile`, `ai_model`), new `*.test.ts` |
| 3.2 | new `src/core/repo-guard.ts`, `src/core/orchestrator.ts`, `src/core/repo-manager.ts` (`fetchAll` rendering), `src/commands/status.ts`, `src/ui/compare.ts` |
| 3.3 | `src/core/git-operations.ts`, `src/core/orchestrator.ts`, `src/commands/pick.ts` |
| 3.4 | `src/core/conflict-resolver.ts`, `src/core/git-operations.ts` |
| 3.5 | `src/core/orchestrator.ts`, `src/github/client.ts`, `src/commands/merge.ts`, `src/commands/pick.ts`, `src/ui/dashboard.ts` |
| 3.6 | `src/commands/config.ts`, `src/commands/merge.ts`, `src/commands/pick.ts`, `src/config/manifest.ts`, `src/cli.ts` |
| 3.7 | delete `src/auth/providers/`, `provider.ts`, `provider-registry.ts`, `call-ai.ts`, `oauth-pkce.ts`; edit `token-manager.ts`, `types.ts`, `src/github/client.ts`, `src/commands/connect.ts`, `src/commands/auth.ts`, `README.md`, `docs/overview.md`, `.env.example` |
| 3.8 | `tsup.config.ts`, `package.json`, `src/context/index.ts`, `src/context/commands/*.md`, `src/context/agents/release-coordinator.md`, `src/config/branding.ts`, `src/commands/rebrand.ts` |
| 3.9 | `src/ui/compare.ts`, `src/core/git-operations.ts`, `src/core/cache.ts` |
| 3.10 | new `src/test/git-fixture.ts`, `tests/e2e/cli.test.ts`, `vitest.config.ts`, `package.json` scripts |

---

## 6. Compatibility, versions, rollout

- Version 0.1.0 → 0.2.0 on the first merged slice; one changeset per PR.
- `auth.json`: unchanged flat shape. Files already migrated to the nested shape by a stray `readAuthFile` call are re-read by a one-time shim that lifts `copilot.*` back to the top level and rewrites the file, then the shim is removed in 0.3.0.
- `gittyup.yaml`: no schema change except the optional `ai_model`. Invalid files that loaded before (none can; Zod rejects them) are unaffected.
- CLI surface: `--pr` without `--branch` now refuses on `merge`/`pick` (was a silent no-op). `-c` with `-g` now refuses (was wrong). Both are called out in the changeset.
- **PR order:** 3.10 (harness) → 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9. 3.6 to 3.9 are independent of each other and can run in parallel once 3.10 is in. README is updated in the PR whose behavior it documents.
- Until 3.1 to 3.3 land, add a one-line warning under the `merge`/`pick` descriptions: "resolution writes whole files only via ours/theirs; AI and manual edit are unsafe in 0.1.x".

---

## 7. Testing

- **Unit** (co-located, vitest, `makeRepo` fixtures): parser, gate, suggest extraction, guard restore/stash paths, cherry-pick resume/abort, escalation tree, template substitution, remote URL parsing, token cascade order, config validation. Target: every bug in §1 has a test that failed before its slice and passes after.
- **E2E** (`tests/e2e/`, built CLI via `bin/gittyup.mjs`): `init`, `config --ai bad`, `merge --no-fetch` on a two-repo fixture driven by stdin answers, `npm pack --dry-run` contents.
- **Manual once per release:** `auth login` → `auth status` shows Copilot ✓ and GitHub API source `gh-cli`; `merge --branch --push --pr` against a scratch GitHub repo opens one PR with a fully substituted body.
- CI: the `js` job runs `pnpm -r test` (unit only once the configs split) plus a dedicated `pnpm --filter @helmsmith/gittyup test:e2e` step beside storybrokr's; it needs `git` on the runner (present) and no network.

---

## 8. Decisions log and open questions

1. **Delete, don't finish, the provider layer** (§3.7). Owner to confirm; reversal cost is a `git revert`.
2. **Escalation commits markers** (§3.4). Owner to confirm.
3. **`--pr` requires `--branch`** (§3.5). Alternative was to make `--pr` imply `--branch`; refusing is chosen so an existing script fails loudly instead of changing what it pushes.
4. **Open: the Copilot client ID.** `COPILOT_CLIENT_ID` is VS Code's, and the chat headers claim `copilot.vim`/`vscode-chat`. This spec keeps them unchanged and documents it in `docs/overview.md`. Whether to register gittyup's own OAuth app is a product decision, not a bug.
5. **Open: default `ai_model`.** `gpt-4o` is kept because it is what runs today; `auth models` output should drive a better default once 3.1 is in use.
