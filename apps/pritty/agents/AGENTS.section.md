## Committing with pritty

Commit through pritty so every commit follows this repository's conventions.

- Use the args form for one commit and `--input=json` for several: `pritty commit --label ABC-1 --type fix --scope api --message "handle empty input" -- src/a.ts`, or `pritty commit --input=json < /tmp/plan.json` with `{ "commits": [{ "label", "type", "scope", "description", "files" }] }`.
- One category per commit, code before tests, paths after `--` (or `files` in the plan): `pritty commit --label ABC-1 --type test --scope api --message "cover empty input" -- src/a.test.ts`.
- Give every commit of a change the same label, the ticket or a short effort name: `--label ABC-1`.
- Mark breaking changes with `--breaking` (or `"breaking": true` in the plan): `pritty commit --breaking --label ABC-1 --type feat --scope api --message "drop the v1 route" -- src/routes.ts`.
- Dry run first, then commit: `pritty commit --input=json --dry-run --output=json < /tmp/plan.json`, then the same without `--dry-run`.
- Read results with `--output=json`: it prints each commit's message, files and sha.
- Open the pull request with `pritty pr --input=json --output=json < /tmp/pr.json`, where the file holds `{ "title", "body" }`.
- Never run `git commit -m` for work that should follow the repository's conventions: `pritty commit` is the way in.
