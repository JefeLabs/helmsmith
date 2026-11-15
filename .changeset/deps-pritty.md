---
"@helmsmith/pritty": patch
---

Dependency updates. `minimatch` 10 → 11 fixes a denial-of-service advisory in glob matching ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)), which has no fix on 10.x. Category globs match the same files as before: on a 16,000-file repository, every file landed in the same category with both versions, using the default categories and a custom set that includes an extglob. `ora` 9 → 10: the spinner now erases only what it drew, so output printed while it spins stays on screen. Also `openai` 7.57, `commander` 15.1 and `@inquirer/prompts` 8.8.
