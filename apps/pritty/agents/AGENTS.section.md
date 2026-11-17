## Committing with pritty

Commit through pritty so every commit follows this repository's conventions.

- Use the args form for one commit and `--input=json` for several: `pritty commit --label ABC-1 --type fix --scope api --message "handle empty input" -- src/a.ts`, or `pritty commit --input=json < "<scratch>/plan.json"` with `{ "commits": [{ "label", "type", "scope", "description", "files" }] }`.
- Keep plan and PR files in the repository's scratch directory, `<scratch>`: the path `git rev-parse --path-format=absolute --git-path pritty` prints. A shared temp file lets another session commit your plan. Double-quote the path in a redirect: it may hold spaces.
- One category per commit, code before tests, paths after `--` (or `files` in the plan): `pritty commit --label ABC-1 --type test --scope api --message "cover empty input" -- src/a.test.ts`.
- Give every commit of a change the same label, the ticket or a short effort name: `--label ABC-1`.
- Mark breaking changes with `--breaking` (or `"breaking": true` in the plan): `pritty commit --breaking --label ABC-1 --type feat --scope api --message "drop the v1 route" -- src/routes.ts`.
- Dry run first, then commit: `pritty commit --input=json --dry-run --output=json < "<scratch>/plan.json"`, then the same without `--dry-run`.
- Read results with `--output=json`: it prints each commit's message, files and sha.
- Open the pull request with `pritty pr --base <branch> --input=json --output=json < "<scratch>/pr.json"`, where the file holds `{ "title", "body" }` and `<branch>` is the base branch the request names (ask when it names none). Leave out `--base <branch>` only when the pritty config sets `baseBranch`: `--output=json` never guesses a base.
- Never run `git commit -m` for work that should follow the repository's conventions: `pritty commit` is the way in.
