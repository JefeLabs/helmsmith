# @helmsmith/workkit

The shared core under helmsmith's work brokers. It knows nothing about any project; every project fact comes from the manifest. Exports TypeScript source (`main: src/index.ts`), so consumers bundle it (tsup `noExternal: [/^@helmsmith\//]`) and declare its runtime dependencies (`picomatch`, `zod`) themselves.

| Module | Provides |
|---|---|
| `types` | `Manifest`, `Lease`, `Effort`, `RegistryFile`, `Owner`, `Mode`, `Notice` |
| `errors` | `WorkkitError(code, message, details?)`, `exitCodeFor` (2 refused, 1 fault), `toErrorBody` |
| `manifest` | `loadManifest(repoRoot)` for `.ts` / `.mjs` / `.json`, `validateManifest` (leaf areas, ports ↔ services, reserved slots, template variables) |
| `registry` | `Registry.open(home)`: projects, leases, efforts; `update()` serialises every mutation under a directory lock and writes atomically; `allocateSlot` hands out the lowest free non-reserved slot |
| `ports` | `portsForSlot`, `rangesFor`, `claimRanges` (per-project ranges, overlap refused) |
| `scopes` | `expandScopes(m, area, mode)`, `globsOverlap`, `pathsMatching`, `commonsTouched` |
| `git` | `Git`: main-checkout detection, `syncFrom` (ff / merge / conflict left in place), worktrees, branches, push |
| `guards` | `checkCommit`, `checkPush`, `assertNotProtected`, `assertNotMainCheckout` |
| `hooks` | `installHooks(repoRoot)` → `.helmsmith/hooks/pre-commit|pre-push` + `core.hooksPath` |
| `config` | `emitWorktreeConfig` (`.slot`, env file, log dir, all excluded from git via `info/exclude`), `renderTemplate`, `slotVars` |
| `refresh` | `selectRefresh`, `runRefresh` |
| `runner` | `startServices` / `waitHealthy` / `stopServices` (detached `sh -c`, health polling, stop only recorded pids) |
| `session` | `currentOwner()` (`WORK_SESSION`, `CLAUDE_SESSION_NAME`, else `user@host:ppid`) |
| `@helmsmith/workkit/testing` | `makeRepo`, `commitFile`, `gitIn`, `minimal` manifest, `http-service.mjs` |

Registry location: `$HELMSMITH_HOME` or `~/.cache/helmsmith`.
