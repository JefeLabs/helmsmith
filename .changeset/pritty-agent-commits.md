---
"@helmsmith/pritty": minor
---

`pritty commit` takes its commits from args (`--label --type --scope --message`, with the staged paths after `--`), from a JSON body on stdin (`--input=json`), or from the model as before; args and JSON make no model call, and `pritty pr` takes the same three inputs (`--title`, `--input=json`, or the model's draft). Every command accepts `--output=json` (`--json` stays as its shorthand), a commit's JSON now carries `label`, `type`, `scope`, `description` and `body`, and a `pr --dry-run` prints its draft as JSON. A new `commitLabels` config key (default `false`) puts a label, a ticket or effort name such as `STATUS-LOGGING`, at the start of every commit subject in the `conventional` and `angular` styles, and a PR whose commits all share one label is titled `LABEL: summary [types] [scopes]`.
