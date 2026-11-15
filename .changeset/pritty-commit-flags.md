---
"@helmsmith/pritty": minor
---

`pritty commit` takes what the caller already knows:

- `--scope <path>` sets every commit's scope: one to three lowercase segments, such as `network`, `org/global` or `org/network/directory`. One scope per effort was impossible before: the model chose it, and one feature appeared as `globaldirectory`, `global-directory` and `directory`.
- `--type <type>` sets the code commits' type; test and storybook commits keep theirs. It wins over the `fix/` branch rule, so a fix on a `feature/` branch can say `fix`.
- `--trailer "Token: value"` (repeatable) adds a trailer to every commit after `commitTrailers`, such as `Refs: plan-5 T9`, so a task's commits can be found with `git log --grep`.

All three are checked before the model is asked. `--type` and `--scope` need the conventional or angular style. A subject the model wrote that is not conventional is kept as written, with a note.

A model that renames one category in its answer no longer fails the run when the pairing is certain. pritty pairs it when there is exactly one name the categorizer did not produce and exactly one category with staged files that nothing claimed, and the run says so. The prompt also tells the model to copy category names exactly. Before this, one run failed with "AI plan names a category the categorizer did not produce: feature".
