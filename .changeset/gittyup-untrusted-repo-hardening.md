---
"@helmsmith/gittyup": patch
---

Harden git execution against an untrusted repository (round-2 review):

- Every git command gittyup runs now disables the repo-config vectors that execute code — `core.fsmonitor`, hooks (`core.hooksPath`), the pager and an external diff driver. gittyup is routinely pointed at cloned repos, where a committed/local `core.fsmonitor` would otherwise run on `status`/`compare`/`merge`/`pick`.
- A branch name or alias that looks like a git option (starts with `-`) is refused, and `merge`/`cherry-pick` pass the revision after `--end-of-options`, so a manifest alias like `--output=…` can no longer be parsed as an option.
