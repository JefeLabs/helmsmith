---
"@helmsmith/pritty": minor
---

Fixes from a one-week trial in which pritty drafted every commit and PR in another repository.

- `pritty commit` commits what its dry run showed. The plan is kept in `<git dir>/pritty/commit-plan.json`, keyed by HEAD, the staged tree, the branch, the categories and the commit style. The next real run with the same key commits it without a second model call (`"reusedPlan": true` under `--json`). A refused commit keeps it for the retry. A dry run always drafts afresh. Before this, the real run asked the model again, so subjects and bodies changed after review; one dropped a `Refs #…` line.
- Commit order no longer comes from the model. Code categories go first, then `test`, then `storybook`. Three real runs had committed tests or stories before the code they need, so the first commit failed its own tests.
- The model is told the branch name. On a `fix/…` branch, a code commit typed `feat`, `build` or `chore` becomes `fix`. Test, story, docs and refactor commits keep their type. Bug fixes had been typed `feat`, `build` or `chore` at least six times.
- `pritty commit --no-verify` passes `--no-verify` to `git commit` for an approved hook bypass.
- A one-category plan the model returns as a bare object, not an array, is accepted. It used to fail with "AI returned non-array output".
- `pritty pr` opens a drafted title with the commits' `type(scope):` prefix. A `--title` is still used verbatim.
- `pritty pr --no-footer` leaves `prFooter` out. A `prFooter` of several lines no longer gets a second copy when the body already ends with it.
- The PR prompt asks for a plain-bullet test plan instead of a checklist of unchecked boxes.
- The model drafting a PR now sees each commit's body and the changed files, and is told to take the why from the bodies. Co-Authored-By, Commit-Message-By and Signed-off-by trailers are left out. Input stays under the commit diff's 12,000-character cap: every subject is kept, long bodies share the room evenly, and the file list is cut first. It used to see only subjects, so every trial PR body made up its why.
