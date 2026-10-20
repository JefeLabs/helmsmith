---
"@helmsmith/gitradar": patch
---

Third slice of the round-2 review (#121), scan integrity:

- #79: incremental scans use a reachability cursor. Each scan records HEAD (and the default-branch tip for the PR proxy) and the next one walks `HEAD ^lastTip`, so commits that reach the clone after the scan but carry older dates — merged branches, pulls after days away — are counted. A rewritten history falls back to a full walk with hash dedup; state from before this release gets one last date walk with a full timestamp, and no bare date is ever passed to git.
- #110: chunked first scans keep the newest hashes for dedup and record the real tip as `lastHash`, so the next incremental scan no longer double-counts the overlap.
- #112: a failed git run (fatal or transient) writes nothing, keeps the repo's cursor, prints `✗`, and makes `scan` exit 1.
- #116: authors track commits per repo; a forced rescan subtracts that repo's share before re-walking it, so `author list` counts stop inflating.
- #111: a scan lock in the store (pid-stamped, reclaimed from dead or ancient holders) makes a concurrent scan yield with "scan in progress" and exit 1; cursors are written one repo at a time instead of rewriting every repo from the startup snapshot.
