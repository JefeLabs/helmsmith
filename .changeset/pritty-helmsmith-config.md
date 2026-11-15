---
"@helmsmith/pritty": minor
---

pritty also reads its config from `.helmsmith/pritty.json` (or `.yaml` / `.yml`), beside the other helmsmith files of a repository: workbrokr's hooks and gitradar's `repos.yml`. It searches the same places as for `.pritty.json`, from the current directory up to the repository root, nearest first. `pritty init` writes `.helmsmith/pritty.json` when the repository has a `.helmsmith` folder, and never adds a second config beside an existing one.

A `.helmsmith/` file and an old-name file (`.pritty.json`, `.prittyrc`, …) may sit in the same directory while a team moves over, because an older pritty reads only the old name. They must hold the same config: pritty refuses to run, naming both files, when they differ. Once everyone runs this version, delete the old file.
