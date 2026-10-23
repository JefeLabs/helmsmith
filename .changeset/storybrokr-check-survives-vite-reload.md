---
"@helmsmith/storybrokr": patch
---

`check` no longer fails stories when Vite reloads the preview while they render. When Vite's dependency cache is stale — the first `check` after `up` on a new or changed setup — Vite re-bundles a dependency it only discovers on the first story load and fully reloads every open page ("optimized dependencies changed. reloading"). Every story in flight was reported as `fail` with `driver error: … Execution context was destroyed`. `check` now waits for the reloaded page and keeps polling within the story's timeout (the event recorder re-installs itself on every load); a page that reloads more than 3 times still fails, with a reason that says so.
