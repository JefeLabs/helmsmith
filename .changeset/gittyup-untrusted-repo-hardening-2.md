---
"@helmsmith/gittyup": patch
---

Complete the untrusted-repo git hardening (round-2 review follow-up):

- The option-like-ref guard now also covers `listCommits`, `checkout`, `push` (remote and branch) and `branchExists`, so a manifest alias or ref beginning with `-` can't be parsed as a git option on any of those paths.
- The config neutralization also disables `core.askpass`, and its comment no longer claims to be a complete sandbox: write/network-time vectors that are also legitimate (commit signing, `core.sshCommand`, `credential.helper`, merge/filter drivers) are deliberately left to a future "refuse a repo whose local config defines them" change rather than blanket-overridden, which would break signing, ssh remotes and private-repo auth.
