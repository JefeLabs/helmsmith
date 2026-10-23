# @helmsmith/gittyup

## 0.3.0

### Minor Changes

- Dependency upgrades, including a security fix:
  
  - `simple-git` ^3.36 → ^4.0.2, closing critical advisories in simple-git < 4.0.1 and its argument parser. **Behaviour change:** simple-git 4 removes inherited `GIT_*` variables (and `EDITOR`, `VISUAL`, `PAGER`, `SSH_ASKPASS`) from every git process it starts, so merge, cherry-pick, commit, fetch and push no longer see an ambient `GIT_SSH_COMMAND`, `GIT_ASKPASS`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*` or `GIT_CONFIG_GLOBAL`. SSH agents (`SSH_AUTH_SOCK`) and identity, credentials and `core.sshCommand` set in git config are unaffected.
  - `@inquirer/*`, `chalk`, `js-yaml`, `zod`, `react` 19.2.9 and `bun` 1.4.4 patch/minor bumps.

## 0.2.2

Published to npm as 0.2.0 – 0.2.2 before this repository tracked those version bumps; the notes below are the changesets those releases shipped.

### Minor Changes

- Test harness: declarative temp-git-repo fixture (`src/test/git-fixture.ts`), e2e harness that spawns the built CLI against isolated temp workspaces, unit/e2e vitest configs split. `test:unit` and `test:integration` scripts removed; `pnpm test` runs co-located unit tests only. First slice of the 2026-10-19 hardening spec; version moves to 0.2.0.

- Conflict resolution writes whole files only. `ConflictFile` now carries the complete OURS/THEIRS/BASE versions from the index stages; one gated write path refuses markers, empty results and one-line fragments; manual edit opens the conflicted file with its markers and reopens on refusal; AI auto sends complete files, shows a line diff and confirms before writing (`--yes` to skip); AI suggest takes the last fenced block of the reply; delete/modify conflicts resolve by deletion when the kept side deleted the file. New `settings.ai_model` (`config --model <id>`, default `gpt-4o`). Hardening spec slice 3.1.

### Patch Changes

- Auth and AI-call safety (round-2 review):

  - A GitHub token taken from the environment (`GITHUB_TOKEN` / `COPILOT_GITHUB_TOKEN`, e.g. in CI) is no longer written into `auth.json`, so it can't replace the token from `gittyup auth login`. `auth.json` is written with owner-only permissions (0600).
  - A Copilot completion that was cut off at the model's output limit (`finish_reason: "length"`) is rejected instead of being used, so a truncated file can't pass the resolution gate and get committed.
  - `git credential fill` in the token cascade runs from a neutral directory with prompting disabled, so a cloned repo's local `credential.helper` can't execute or block.

- CLI robustness (round-2 review):

  - `merge` and `pick` no longer hang or silently proceed without a terminal: the plan confirmation is gated so a non-interactive run (CI, a pipe) exits non-zero with a message to pass `--yes`, and `--yes` now also skips that plan confirmation (C1).
  - `repo add <path>` and `find` store the repo's absolute path (resolved where the command runs), and `init` sets the manifest workspace to the working directory rather than the config folder. The documented quick start (`init`, then `repo add ./x` or `find`) now registers repos that actually resolve, instead of every row showing "Repo path not found" (C3).

- Dashboard and compare correctness (round-2 review):

  - `compare` now detects merge conflicts. The check reads `git merge-tree`'s real exit code (1 = conflicts) via a direct invocation; it previously ran through simple-git, which reports that exit code as success, so compare always showed "no conflicts". A genuine merge-tree failure (bad ref, old git) now surfaces as the row's error instead of a guessed boolean.
  - The dashboard "last commit", every `compare` column and `pick -i`'s commit list read the named branch's own history (`git log <branch>`), not a `<branch>...HEAD` range relative to whatever is checked out.
  - The `compare` result cache is namespaced by the resolved manifest, so one workspace is never shown another workspace's cached rows.

- Operation safety for merge and cherry-pick (round-2 review):

  - A merge or cherry-pick refuses to start when the repo is already mid-merge, mid-cherry-pick, mid-revert, mid-rebase, or carrying an unmerged index, with a message naming the state and how to clear it, instead of operating on top of it (G12).
  - A cherry-pick whose change is already present on the target (an "empty" pick — common when back-publishing a fix that reached the branch another way) is dropped with `--empty=drop` instead of stopping with a dangling cherry-pick and a hard "failed" result (G15). Requires git ≥ 2.45.

- Make the package installable from npm (round-2 review, C6). The build bundles the `@helmsmith/*` workspace libraries (`cli-kit`, `tui-view-components`) into `dist`, so the published package no longer declares `workspace:*` dependencies that npm cannot resolve — `@helmsmith/tui-view-components` is private and unpublished. The third-party peers the bundled TUI needs (`@opentui/core`, `@opentui/react`, `react`) are declared as real dependencies, matching the other toolbox CLIs. A packaging test asserts the published `dependencies` contain no `workspace:` range and no `@helmsmith/*` package.

- Complete the option-like-ref guard: `fetch` (the remote) and `createConflictBranch` (the constructed branch name) now go through the same check as the other git operations, so no ref-taking path is left unguarded.

- Return each repo to its starting state after a merge or cherry-pick (round-2 review, spec §3.2). Uncommitted changes are stashed on the branch the operation started from and popped back there, and HEAD is returned to that branch — instead of the previous flow, which stashed on one branch and popped onto whichever branch the operation left checked out (so edits on `main` resurfaced on the target branch, and the repo was left on the target). When the operation leaves the repo mid-conflict and the user keeps it, the stash is left in place and named rather than popped onto the wrong tree.

- Repo safety and honest exit codes (round-2 review):

  - `merge` and `cherry-pick` verify HEAD actually switched to the named branch. A target that happens to match a tracked file or directory (but is not a branch) no longer causes the operation to land on the *current* branch while the result shows success.
  - `merge`, `pick` and `fetch` exit non-zero when any repo errored or was left conflicted, instead of always exiting 0.
  - A failed `git fetch` is now surfaced: `GitOperations.fetch` uses a raw invocation that rejects on a non-zero exit, where simple-git's `.fetch()` resolved even when the remote did not exist, so a failed fetch was reported as "fetched".

- Harden conflict resolution (round-2 review, on top of the whole-file-resolution slice):

  - A conflict resolution is never read or written through a symlink. A side that replaced the file with a symlink no longer makes `getConflictedFiles` read a file from outside the repo into the AI prompt, and `applyResolution` refuses a symlinked or out-of-repo destination instead of overwriting whatever it points at.
  - The resolution gate catches conflict markers of any size (a non-default `conflict-marker-size`), and no longer refuses a legitimate line of exactly seven `=` such as a Setext/RST heading underline.
  - Keeping one side of a submodule (gitlink) conflict preserves the submodule instead of deleting it: deletion is decided from `git ls-files -u`, not from whether `git show` could print the stage.

- Complete the untrusted-repo git hardening (round-2 review follow-up):

  - The option-like-ref guard now also covers `listCommits`, `checkout`, `push` (remote and branch) and `branchExists`, so a manifest alias or ref beginning with `-` can't be parsed as a git option on any of those paths.
  - The config neutralization also disables `core.askpass`, and its comment no longer claims to be a complete sandbox: write/network-time vectors that are also legitimate (commit signing, `core.sshCommand`, `credential.helper`, merge/filter drivers) are deliberately left to a future "refuse a repo whose local config defines them" change rather than blanket-overridden, which would break signing, ssh remotes and private-repo auth.

- Harden git execution against an untrusted repository (round-2 review):

  - Every git command gittyup runs now disables the repo-config vectors that execute code — `core.fsmonitor`, hooks (`core.hooksPath`), the pager and an external diff driver. gittyup is routinely pointed at cloned repos, where a committed/local `core.fsmonitor` would otherwise run on `status`/`compare`/`merge`/`pick`.
  - A branch name or alias that looks like a git option (starts with `-`) is refused, and `merge`/`cherry-pick` pass the revision after `--end-of-options`, so a manifest alias like `--output=…` can no longer be parsed as an option.

- Security: the Bun launcher no longer loads `bunfig.toml` or `.env*` files from the current directory. Previously, running the CLI inside a directory containing a `bunfig.toml` with a `preload` executed that script (and a `.env` there was loaded into the CLI's environment), so invoking the tool inside a cloned repo could run that repo's code. The launcher now starts Bun with `--no-env-file` and `--config=<package>/bunfig.toml`, and the package ships an empty `bunfig.toml`.

  timetracker still reads `./.env` itself through its config loader, as documented; `.env.local` and other `.env.*` variants that only Bun's auto-loader picked up are no longer read. Running a CLI directly under Bun (`bun x …`) bypasses the Node launcher and is not covered.
