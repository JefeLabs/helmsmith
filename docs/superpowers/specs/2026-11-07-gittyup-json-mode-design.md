# gittyup — `--json` response mode for agents and scripts (design)

**Status:** draft for owner review, 2026-11-07. Written from a conversation with the owner and checked by an independent builder review. Decisions marked *owner* came from them; decisions marked *my call* are the author's and are open to override (see §10).

**Related:** `docs/superpowers/specs/2026-10-19-gittyup-hardening-design.md` (the hardening series). This design pulls in part of its §3.3 (resumable cherry-pick) and depends on nothing else unlanded.

## 1. Intent

gittyup is called by people today. The owner wants it callable by **agents and scripts like workbrokr** (*owner*), the same way workbrokr already calls `storybrokr … --json` and `pritty … --json`. That makes `--json` a contract: a program parses it, branches on it, and acts on it without a human reading anything. Every choice below follows from "a program will trust this output."

The owner wants this for **both** read commands (`status`, `compare`, …) **and** the commands that change repos (`merge`, `pick`) (*owner*).

## 2. Goals, non-goals, anti-goals

**Goals**
- Every command a program would reasonably call accepts `--json` and, with it, prints exactly one JSON document to stdout.
- `merge` and `pick` run to completion with no human: on a conflict, gittyup's own agent tries to resolve it; if that fails, the repo is rolled back to exactly where it started and the conflict is reported (*owner*).
- A failure is machine-readable: a JSON error body on stderr and an exit code that says "refused" vs "broken", matching workbrokr/storybrokr.

**Non-goals**
- A pause/resume protocol where gittyup stops mid-conflict and the *calling* agent resolves it (considered and rejected by the owner in favour of gittyup's own agent).
- Moving AI resolution onto `@helmsmith/agent-adapter` (Claude, etc.). The existing Copilot resolver is reused. Whether to adopt agent-adapter is the hardening spec's open §8 decision.
- Escalation branches (hardening §3.4), the `--branch` option and PR fixes (hardening §3.5), and the interactive pick-resume fix (rest of hardening §3.3).
- JSON for commands that need a person: `connect` (TUI), `auth login` (device flow), `auth logout`, `init`, the hidden `rebrand`.
- Any change to text-mode output, except where shared code changes underneath it (§7).

**Anti-goals** (would make this a failure even if it "works")
- **JSON that states something untrue.** A row that says "applied 5 commits" when 3 were applied, `ahead: 0` when there is no tracking branch, or a PR that silently wasn't opened. Agents act on these facts.
- **Anything on stdout besides the one JSON document.** pritty prints text before its JSON, and workbrokr has to scrape "the last JSON line" (`apps/workbrokr/src/lib/pritty.ts`). gittyup must not need that workaround.
- **A prompt in JSON mode.** A prompt with no TTY either hangs an agent or fails confusingly. JSON mode never prompts.
- **Leaving a repo mid-merge / mid-cherry-pick** after a JSON-mode run, or on a different branch than it started.

## 3. The contract

Matches the convention already shared by workbrokr (`apps/workbrokr/src/commands/_shared/output.ts`) and storybrokr (`apps/storybrokr/src/commands/_shared/output.ts`).

### 3.1 Streams and exit codes

| Outcome | stdout | stderr | exit |
|---|---|---|---|
| Command succeeded | exactly one line: the JSON document, compact (`JSON.stringify(v)`) + `\n` | anything (progress, warnings), free text, never parsed | 0 |
| Multi-repo operation ran, some repos did not succeed (`merge`, `pick`, `fetch`) | the full report, same as success | anything | 1 (keeps today's G5/C2 behaviour) |
| Refused before doing anything (bad args, unknown target, a rule said no) | **empty** | one line: `{"code": "...", "message": "...", "details"?: {...}}` | 2 |
| Broken (unexpected exception, git or GitHub failure outside a per-repo row) | **empty** | one line, same shape | 1 |

*My call:* one compact line, not pretty-printed. workbrokr parses sibling output two ways, whole stdout (`storybrokr`, `apps/workbrokr/src/lib/storybrokr.ts`) and last non-empty line (`pritty`, `lastJsonLine` in `apps/workbrokr/src/lib/pritty.ts`), and only a single line satisfies both. pritty's in-flight `--json` work (worktree `.worktrees/pritty-json`, `apps/pritty/src/commands/_shared/output.ts`, uncommitted) also emits one line.

*My call:* a multi-repo run always prints its report, even when some repos failed, because "8 merged, 2 conflicted" is the result the caller needs. The exit code is the summary, the report is the truth. A caller distinguishes "partial" (exit 1 + stdout report) from "broken" (exit 1 + empty stdout + stderr error body) by whether stdout is empty.

### 3.2 Error codes

*My call* — a small set, extendable. Refusals (exit 2):

| Code | When |
|---|---|
| `USAGE` | commander parse errors (unknown option, missing argument) and invalid option combinations |
| `CONFIRMATION_REQUIRED` | `merge`/`pick` with `--json` but without `--yes` |
| `INTERACTIVE_ONLY` | a JSON-mode request that would need a prompt: `pick --json` without `--commits`, `pick --json --interactive`, `repo tag --json` without `--add`/`--remove`, `merge`/`pick --json --ai suggest` |
| `TARGET_REQUIRED` | `merge`/`pick` without `--group` or `--repo` |
| `TARGET_UNKNOWN` | `--group`/`--repo` names nothing in the manifest (today: a thrown `Error` from `RepoManager.getReposForTarget`) |
| `GROUP_EXISTS`, `GROUP_NOT_FOUND`, `REPO_EXISTS`, `REPO_NOT_FOUND` | manifest CRUD (today: thrown `Error`s in `ManifestManager`) |
| `PATH_NOT_FOUND` | `find` on a missing directory |
| `MANIFEST_INVALID` | the manifest fails schema validation |
| `AUTH_REQUIRED` | a command that needs a GitHub token (`prs`) has none |

Broken (exit 1): `GIT_FAILED`, `GITHUB_FAILED`, `INTERNAL` (anything not mapped).

Cross-app note: pritty's in-flight `--json` keeps failures as plain text on stderr with exit 1. gittyup follows workbrokr/storybrokr's JSON error body instead, because an agent needs a code to branch on. Unifying the three apps (e.g. a shared helper in `@helmsmith/cli-kit`) is out of scope here.

Implementation: a `GittyupError(code, message, details?)` class plus `toErrorBody(err)` / `exitCodeFor(code)`, mirroring `apps/workbrokr/src/core/errors.ts`. Existing `throw new Error(...)` sites that a JSON caller can hit are converted to `GittyupError` with the codes above.

*My call (after review):* **text mode is untouched**, with the same output and the same exit codes (1). The error mapping and exit 2 take effect only with `--json`. Several text-mode errors currently escape as an uncaught Bun stack trace (e.g. `gittyup group remove nope`). Tidying that is a separate change, because existing scripts would notice a text-mode exit-code change.

### 3.3 Never prompt

With `--json`, no code path may reach `@inquirer/*`, `confirmGate`, or the `ConflictResolver` menus. Every place that would prompt either has a JSON-mode answer (below) or refuses with `INTERACTIVE_ONLY`. A test asserts this by running each JSON command with stdin closed and a short timeout (`runCli` already closes stdin; a prompt would fail or hang).

### 3.4 Honest values

- Dates are the ISO-8601 strings git already gives (`%aI`), not display-formatted.
- SHAs are full 40-char hashes (text mode keeps the 8-char display).
- **Unknown is `null`, not `0`/`false`.** In particular `ahead`/`behind` are `null` when the tracking ref does not exist (today `getBranchState` swallows the `rev-list` failure and reports `0/0`, indistinguishable from "in sync"). Read failures that today become the string `'error'`/`'unknown'` become `null` plus an `error` field.
- No ANSI escapes anywhere in JSON values (OSC 8 hyperlinks in compare included).

### 3.5 Keeping stdout clean

Many `console.log` calls sit deep in shared code (`Orchestrator`, `ConflictResolver`, `Dashboard.renderOperationResults`, `CliCache.printCacheNotice`, `attachPRs`'s "Could not create PR", the `postAction` `config:` footer in `cli.ts`).

*My call (recommended, builder may refine):* when `--json` is present, the CLI entry captures the real stdout writer for the final JSON document and **redirects `console.log` to stderr** for the rest of the process. This guarantees that a missed print can never corrupt the document. On top of that backstop, JSON-mode code paths skip purely decorative output (tables, banners, the `config:` footer, the merge/pick "Plan" listing) rather than sending it to stderr. `ora` spinners already write to stderr. They are disabled in JSON mode (`isEnabled: false`) so stderr stays readable in logs.

`--json` is a per-command option (like the siblings), detected once in `cli.ts` before `program.parse()` (e.g. a `preAction` hook reading `actionCommand.opts().json`) so the redirect is in place before any action code runs.

### 3.6 Stability

*My call:* no version field in the documents (the siblings have none). Shapes in §4 are the contract, and every shape is pinned by an e2e contract test (§8).

**Stability while hardening is unfinished** (*owner*, 2026-11-07). Three unlanded slices will change behaviour this contract exposes:
- §3.5 refuses `--pr` without `--branch` up front. Here, that case is a `skipped` PR row.
- §3.3 refuses `-c` with `-g`. Here, a repo lacking a SHA gets an `error` row.
- §3.9 changes compare's counts and tracking refs. Here, today's fields stay and new ones are added.

While gittyup is 0.x, the contract **may change when a hardening slice lands**, and each such change is called out in the CHANGELOG under a "JSON contract" heading. Field shapes otherwise only grow. The firm additive-only promise starts at 1.0, after hardening §3.3–3.5 and §3.9. Do not pull those slices into this work to freeze the contract early.

## 4. Commands and their documents

Shapes are TypeScript-ish. `?` = may be absent, `| null` = present but unknown.

### Read

**`status [--group|--repo] [--fetch] --json`**
```ts
{
  generatedAt: string,                       // ISO
  manifest: { path: string, exists: boolean },
  fetch: null | Array<{ repo: string, ok: boolean, error?: string }>,   // only with --fetch
  repos: Array<{
    name: string, group: string, path: string,
    currentBranch: string | null,
    hasUnresolved: boolean,                  // repo is mid-merge/pick right now
    error?: string,                          // repo unreadable; branches = {}
    branches: Record<alias, {
      branch: string,
      trackingBranch: string,
      tracking: boolean,                     // tracking ref exists
      ahead: number | null, behind: number | null,
      isDirty: boolean, hasConflicts: boolean,
      lastCommit: { sha: string, date: string } | null,
    }>,
  }>,
  summary: { repos: number, withConflicts: number, withErrors: number },
}
```
`--compact` is ignored in JSON mode (it only changes the table).

**`compare <left> <right> [...] --json`**
```ts
{
  left: string, right: string,               // as given (aliases)
  cache: { hit: boolean, ageMs: number | null },
  repos: Array<{
    name: string, group: string, url: string | null,
    leftRef: string, rightRef: string,       // resolved branch names
    hasConflicts: boolean | null,            // null with --no-conflicts
    left:  { lastCommitDate: string, author: string, sinceDays: number,
             commitCount: number } | null,   // today's value: commits reachable from the branch (whole history, capped at 9999)
                                             // hardening §3.9's "only on this side" counts will arrive as NEW fields
    right: { ... } | null,
    pr: { number: number, state: 'open'|'closed'|'merged', url: string, date?: string } | null,
    error?: string,
  }>,
  prLookup: { ran: boolean, error?: string },   // "Could not fetch PR data" lands here, not on stdout
  summary: { repos: number, withConflicts: number, clean: number },
}
```

**`prs [--group] --json`** → `{ repos: Array<{ name, prs: Array<{ number, title, head, base, url }>, error? }> }`. All open PRs, not the text view's first 10. No token → `AUTH_REQUIRED`.

**`repo list --json`** → `{ manifest: { path, exists }, groups: Array<{ name, description: string | null, repos: Array<{ name, path, remote, url: string | null, branches: Record<string,string>, tags: string[] }> }> }`. `--tags` is ignored (tags are always included).

**`repo tags --json`** → `{ tags: Array<{ tag: string, repos: number }> }`, sorted by tag.

**`find [dir] [--depth] [--no-metadata] --json`** → `{ root: string, repos: Array<{ name, absolutePath, relativePath, remoteUrl: string|null, currentBranch: string|null, isDirty: boolean|null }> }`. Discovery only: the interactive "add to manifest" flow does not run. To add, the caller uses `repo add`.

**`auth status --json`** → `{ agent: { available: boolean, source: string | null, reachable: boolean | null }, github: { available: boolean, source: string | null } }`.

*My call (after review):* two rows, because two different token lookups are in play and a caller needs to know which one its next command will use.
- `agent` is the lookup the AI resolver uses (`resolveGitHubToken`: `COPILOT_GITHUB_TOKEN` > `GITHUB_TOKEN` > `auth.json`). It is also what text-mode `auth status` and `config --show` show today. `reachable` is the Copilot token exchange that text-mode `auth status` already performs (`getCopilotToken`), and is `null` when there is no token.
- `github` is the lookup GitHub API calls use (`requireGitHubToken`, which adds `gh auth token` and git credential). That covers `prs`, `--pr`, and compare's PR lookup.

A caller asking "will the agent run?" reads `agent`. One asking "will `--pr` work?" reads `github`. Only sources are reported, never a token or a fragment of one. Today `requireGitHubToken` labels gh-CLI and git-credential tokens as `auth.json`, and the JSON reports what the code reports until hardening §3.7 (which also plans to show both rows) fixes the labels.

**`auth models --json`** → `{ models: Array<{ id, maxPromptTokens: number|null, maxOutputTokens: number|null }> }`. Not logged in → `AUTH_REQUIRED`.

**`config --show --json`** (and bare `config --json`) → `{ manifest: { path, location }, settings: { aiMode, aiModel, aiModelIsDefault: boolean, conflictBranchPrefix }, agent: { available: boolean, source: string | null }, github: { available: boolean, source: string | null } }`. Same two lookups as `auth status`, without the network check.

### Change gittyup's own config

Each returns what it did, so a caller can confirm without a second read:

| Command | Document |
|---|---|
| `repo add … --json` | `{ added: { group, groupCreated: boolean, repo: <repo as in repo list> } }` |
| `repo remove <g> <n> --json` | `{ removed: { group, repo } }` |
| `repo tag --add/--remove [--group] --json` | `{ updated: Array<{ repo, tags: string[] }>, added: string[], removed: string[] }` |
| `group create <n> [--desc] --json` | `{ created: { group, description: string\|null } }` |
| `group remove <n> --json` | `{ removed: { group } }` |
| `config --ai/--model --json` | same document as `config --show --json`, after the change |
| `cache clear --json` / `cache prune --json` | `{ cleared: number }` / `{ pruned: number }` |

`repo add --branches <json>` with invalid JSON → `USAGE` (today an uncaught `SyntaxError`).

### Change repos

**`fetch [--group] --json`** → `{ repos: Array<{ repo, ok: boolean, error?: string }> }`, exit 1 if any failed (today's behaviour).

**`merge` and `pick`**: §5.

## 5. `merge` and `pick` under `--json`

### 5.1 Preconditions (all refusals, exit 2, nothing touched)

- `--yes` is required (`CONFIRMATION_REQUIRED`). The text-mode "Plan" listing and `confirmGate` are skipped; `--yes` *is* the confirmation.
- `--group` or `--repo` is required (`TARGET_REQUIRED`), and must exist (`TARGET_UNKNOWN`).
- `pick` needs `-s`, `-t` (`USAGE`) and `--commits` (`INTERACTIVE_ONLY`; `--interactive` is refused too).
- `--ai suggest` on the command line is refused (`INTERACTIVE_ONLY`): the caller explicitly asked for a mode that shows a person a proposal.
- *My call (revised after review):* the effective mode is `--ai` if given, else the manifest's `settings.ai_mode`, mapped for JSON as follows:
  - `auto` → the agent tries first.
  - `suggest` → the agent tries first. This is the schema default and exists for humans, so in JSON mode it reads as "AI allowed".
  - `manual` → no agent; roll back on conflict.

  A manifest set to `manual` is an explicit opt-out, plausibly to keep that code away from an outside model, so JSON mode **honours it**. Sending those files to Copilot because the caller didn't repeat the opt-out would be a leak. A caller that passes `--ai auto` overrides the manifest, the same precedence as text mode (`opts.ai ?? settings.ai_mode`). The report's `agent` block says which mode applied and where it came from.
- `--commits` applies the same SHAs to every repo in the target, as in text mode. A repo that lacks a SHA gets an `error` row. Hardening §3.3 plans to refuse `-c` with `-g`.
- **Pre-fetch** (unless `--no-fetch`): a repo whose fetch fails is not merged or picked. Its row is `skipped` with the fetch error, and it counts toward exit 1. Today merge/pick swallow fetch errors (`catch {}` in `Orchestrator`). Text mode is unchanged here, since hardening §3.2's fetch reporting covers it. `skipped` is used for nothing else.

### 5.2 Per repo

Each repo runs inside the existing `GitOperations.withRepoGuard` (refuses a repo already mid-operation, stashes, restores the start branch and stash afterwards). A guard refusal becomes that repo's `error` row, and the run continues with the next repo.

**Merge:**
1. `git merge <source>` on `<target>` (existing `GitOperations.merge`).
2. Clean → commit exists → `--push` if asked → row `success`.
3. Conflicts → agent resolution (§5.3).
   - All files resolved → commit the merge (`commitResolution`) → `--push` if asked → row `success`, `resolvedBy: "agent"`.
   - Any file not resolved → `git merge --abort` → row `conflict`, `rolledBack: true`.

**Pick** (this is the slice of hardening §3.3 that JSON mode needs):
1. Record `preSha = rev-parse <target>` after switching to it.
2. Apply commits in order (`cherry-pick --empty=drop`).
3. On a conflict at commit *k*: agent resolution (§5.3).
   - All files resolved → finish commit *k* **keeping its original message and author** (`git cherry-pick --continue` with `GIT_EDITOR=true`, not `commitResolution`'s `git commit -m`) → continue with commit *k+1*. Each later conflict gets the same treatment.
   - Any file not resolved → `git cherry-pick --abort` then `git reset --hard <preSha>` → row `conflict`, `rolledBack: true`, `stoppedAt: <sha k>`. The reset undoes commits 1..k−1 that this run applied. It is safe because `withRepoGuard` guaranteed a clean tree on entry (stashed) and `preSha` was recorded by this run on this branch. The builder should assert `HEAD` descends from `preSha` before resetting and turn a violation into an `error` row instead of resetting.
4. All applied → `--push` if asked → row `success`.

The new git primitives (continue a pick, record/reset to `preSha`) live in `GitOperations` so hardening §3.3 can reuse them for the interactive path later. The interactive (text-mode) pick flow is **not** changed by this work.

### 5.3 Agent resolution (headless)

A new non-interactive path beside `ConflictResolver`'s menus (*my call:* a separate `HeadlessResolver` or a `resolveAllHeadless()` method; it must not reuse the menu loop, whose fallbacks are prompts):

For each conflicted file (`getConflictedFiles()` → `ConflictFile` with `markedContent/ours/theirs/base`):
1. No agent available (no token from `resolveGitHubToken`, or Copilot token exchange fails) → file outcome `agent_unavailable`. Checked once per run, not per file.
2. Ask the agent for the whole file. This is the existing `onAiResolve(file, 'auto')` → `callCopilot(buildAiMessages(file, 'auto'), aiModel)`.
3. `stripOuterFence`, then `checkResolution` (the existing gate: no markers, not truncated, …). Refused → outcome `agent_refused` with the gate's reason.
4. `applyResolution(file, content)` (the only writer; refuses symlinks/escapes) → outcome `resolved`. A `ResolutionRejected`/symlink refusal → `agent_refused`.
5. Network/model error → `agent_error` with the message.

A repo is resolved only if **every** file is `resolved`. One failure rolls back the whole repo (§5.2), and gittyup does not leave a half-resolved repo.

**Traceability** (*my call, after review*). There is no usage log to lean on. `callCopilot` logs nothing, and the only logger (`callAI` in `src/auth/call-ai.ts`) is dead code that hardening §3.7 deletes. Its `readAuthFile()` also rewrites a flat `auth.json` into a nested format the live reader can't parse, so do **not** route calls through it. Instead:
- Every commit gittyup makes that contains agent-written content carries a trailer, `Resolved-by: gittyup agent (<model>)`. That means the merge commit, or each cherry-picked commit whose conflict the agent resolved, appended to the original message.
- The report lists the files (`conflicts[].outcome = 'resolved'`).

`--push` can publish these commits without a human looking, so the trailer is how a reviewer finds them later (`git log --format='%(trailers:key=Resolved-by)'`).

### 5.4 The report

```ts
{
  operation: 'merge' | 'pick',
  source: string, target: string,            // as given (aliases)
  agent: { mode: 'auto' | 'manual', modeSource: 'flag' | 'manifest', model: string, available: boolean },
  repos: Array<{
    repo: string,
    sourceRef: string, targetRef: string,    // resolved branch names
    status: 'success' | 'conflict' | 'error' | 'skipped',
    message: string,                         // human-readable, never parsed
    // pick only:
    commits?: { requested: string[], applied: string[], dropped: string[] },  // dropped = already present (--empty=drop)
    stoppedAt?: string,                      // pick conflict: the sha that could not be resolved
    resolvedBy: 'agent' | null,              // non-null only when the agent resolved ≥1 conflict
    conflicts: Array<{                       // every conflicted file the run met, resolved or not
      path: string,
      commit?: string,                       // pick: which commit's conflict
      outcome: 'resolved' | 'agent_unavailable' | 'agent_refused' | 'agent_error' | 'not_attempted',
      reason?: string,
    }>,
    rolledBack: boolean,
    head: string | null,                     // target branch sha after the run (== pre-run sha when rolled back)
    pushed: boolean,
    pr: null | { status: 'created' | 'existing' | 'skipped' | 'error', url?: string, number?: number, reason?: string },
    error?: string,
  }>,
  summary: { repos: number, success: number, conflict: number, error: number, skipped: number },
}
```
`not_attempted` covers `--ai manual` and files left untried after an earlier file in the same repo already failed. *My call:* stop at the first failed file, since the repo will be rolled back anyway and every further agent call is wasted spend.

**`--pr`** (*my call*): attempted as today, but never swallowed. `head === base` (always true after a clean merge until hardening §3.5's `--branch` lands) → `{ status: 'skipped', reason: 'head equals base; needs --branch (hardening §3.5)' }` without calling GitHub. GitHub errors → `{ status: 'error', reason: <GitHub message> }`. `--pr` on a rolled-back repo → `skipped`. PR outcomes do not change the exit code (the git work succeeded).

**`--push`**: a push failure turns the row into `error` with the message. The commits stay applied locally, so `head` reflects them and `pushed: false`.

## 6. What stays out, found during validation

The 2026-11-07 validation run found bugs that are **not** part of this design and go in their own small PRs:

1. **`connect` (and every `runConnectView`/`runTuiView` app) never exits after `q`.** `platform/core/tui-view-components-lib/src/pages/runConnectView.ts` and `runTuiView.ts` call `renderer.stop()` (pauses rendering, keeps the terminal) and a non-existent `close()`. `destroy()` releases it. Proven with a probe: `stop()` → process alive after 6 s; `destroy()` → exits at once. Affects gittyup, gitradar, mech-pencil (`connect`, `wizard`), taskmaster.
2. **ConnectView hides login errors.** `ConnectView.tsx` `runAction`'s `catch` writes "login failed: …" and the `finally` → `refreshAll()` overwrites it immediately.
3. **gittyup `connect` reports the wrong auth state.** It checks `GITHUB_TOKEN ?? GH_TOKEN`; the real cascade (`requireGitHubToken`) is `COPILOT_GITHUB_TOKEN` > `GITHUB_TOKEN` > `auth.json` > `gh auth token` > git credential, and ignores `GH_TOKEN`.
4. **cli-table3 default styles leak ANSI into pipes** (red headers, grey borders even when not a TTY; headers meant to be dim render red on a TTY). `Dashboard` tables need `style: { head: [], border: [] }`.
5. **The `config:` footer says `[home]`** for a manifest found by walking up from the cwd (`resolveManifestPath` step 2).

## 7. Shared-code changes that touch text mode

- `getBranchState` distinguishes "no tracking ref" from "in sync" (§3.4). *My call:* text mode shows `–` instead of `0` for ahead/behind when untracked. This is a deliberate small text change, because it is the same lie.
- Converting thrown `Error`s to `GittyupError` does not change text-mode wording.
- The new pick primitives (§5.2) are additive. The interactive path keeps calling the old ones until hardening §3.3.

## 8. Testing

- **Contract e2e** (`tests/e2e/`, existing `createWorkspace`/`runCli` + `makeRepo` fixtures): for every command in §4, run with `--json` and assert stdout `JSON.parse`s as exactly one document matching the shape, stderr carries no JSON, exit code is right. For every refusal in §3.2, assert stdout is empty, stderr is one parseable line with the right `code`, exit 2. Use `expect.stringMatching` / explicit field checks: bare RegExp inside `toMatchObject` asserts nothing in this repo (vitest 5).
- **No-prompt** (§3.3): each JSON command with stdin closed finishes within the timeout.
- **merge/pick e2e, no agent** (tokens blanked by `runCli`): a conflicting merge and a pick conflicting at commit 2 of 3 → `conflict`, `rolledBack: true`, outcome `agent_unavailable`, target sha unchanged, no `MERGE_HEAD`/`CHERRY_PICK_HEAD`, start branch and stash restored.
- **Agent paths, unit** (the AI call is network-bound): the orchestrator/headless resolver takes the `onAiResolve` callback by injection. Cases: all files resolved (merge commit exists; pick continues and applies k+1..N with original messages/authors), one file refused by the gate (rollback), agent throws (rollback, `agent_error`), multi-commit pick where the second conflict fails (reset to `preSha`, all earlier picks undone).
- **Honest values:** a repo with no remote reports `ahead: null`, `tracking: false`.

## 9. Delivery

- **Build on the rename.** As of 2026-11-07 the main checkout is on `chore/rename-agentx-to-helmsmith` with an uncommitted repo-wide `agentx` → `helmsmith` rename (hard cut: `~/.helmsmith`, `HELMSMITH_*` env, no `~/.agentx` fallback) that touches gittyup (`src/config/branding.ts`, `src/utils/home.ts`, the e2e env). Start this work from a branch that contains the rename, or re-run `git grep -i agentx` on the result if it lands first. Do not hardcode `AGENTX_*` names in new code or tests.
- One PR is plausible but large. *My call:* two PRs: **(1)** the contract (§3), the error class, the stdout guard, and JSON for every non-merge/pick command; **(2)** merge/pick (§5) with the headless resolver and pick primitives. PR 1 is useful to workbrokr on its own.
- README: a "Scripting with `--json`" section listing the contract and each document. CHANGELOG via changeset; minor bump (0.4.0).
- Run the full gittyup unit + e2e suites before each PR (see the release-process note).

## 10. Decisions log

| Decision | By |
|---|---|
| Consumers are agents and scripts like workbrokr | owner |
| JSON for both read commands and merge/pick | owner |
| On conflict: gittyup's own agent tries first, then roll back and report | owner |
| Calling-agent pause/resume protocol: out | owner (chose gittyup's own agent) |
| Contract copies workbrokr/storybrokr (bare object, stderr error body, exit 2/1) | my call |
| stdout is one compact JSON line (parseable whole or as last line) | my call |
| Multi-repo partial success: report on stdout + exit 1 | my call |
| Error code set (§3.2) | my call |
| stdout guard: redirect `console.log` to stderr in JSON mode | my call |
| `--json` requires `--yes` for merge/pick; `--ai suggest` flag refused | my call |
| Mode = `--ai` ?? manifest; manifest `manual` honoured (no code to the agent), `suggest` → agent-first | my call (after review) |
| `auth status`/`config --show` report two rows: agent token vs GitHub API token | my call (after review) |
| No usage log; `Resolved-by: gittyup agent (<model>)` trailer on agent-resolved commits | my call (after review) |
| Pre-fetch failure → row `skipped`, exit 1 | my call (after review) |
| Text mode keeps exit 1 and its output; error mapping only under `--json` | my call (after review) |
| Contract may change when hardening slices land while 0.x (CHANGELOG-flagged); firm at 1.0 | owner (accepted recommendation) |
| Stop at first failed file in a repo | my call |
| `--pr` reported honestly, `head===base` → `skipped`; `--branch` stays in hardening §3.5 | my call |
| Reuse the Copilot resolver; agent-adapter migration out | my call |
| Text mode shows `–` for untracked ahead/behind | my call |
| Two PRs | my call |
