# HELM-T5: @opentui/react@0.2.16 extensionless ESM import breaks under Node

**Labels:** `upstream` · `area:tui`
**Status:** ✅ RESOLVED (made apps self-contained under Bun)
**CI exclusion:** none

## Resolution

Investigation showed this isn't fixable for Node: `@opentui/react@0.4.2` (latest)
still emits the extensionless `react-reconciler/constants` import, and patching
react-reconciler's exports only uncovers a **deeper** blocker — `bun-ffi-structs`
requires Bun's FFI. `@opentui` is a Bun-native lib; it cannot run under plain Node
by design. So the fix is to make the apps reliably run under **Bun**, not to make
them run under Node:

1. **bun is a managed dependency** — already declared in the TUI/build apps + in
   `pnpm.onlyBuiltDependencies`; also added to the root (`node_modules/.bin/bun`),
   so installs vendor a pinned bun (no global Bun needed).
2. **Self-contained bin launchers** — the app bins now start with
   `#!/usr/bin/env node` and a bootstrap: if not already under Bun, re-exec the
   bundle via the **vendored** bun (`require.resolve('bun/package.json')` →
   `bin/bun.exe`), falling back to a system bun, else a clear "requires Bun" error.
   Under Bun they fall through to the app entry. (gitradar already did this via a
   shell wrapper.)

Verified (Node 22, vendored bun): taskmaster/gittyup/mech-pencil/toolz/
discord-timetracker/skillzkit all launch via `node <bin>` (re-exec → Bun → run);
`bun <bin>` falls through directly. `pritty` re-execs fine but then hits a
*separate* phantom-dep bug → **HELM-T6**.

---

_Original report below._

## Summary

`@opentui/react@0.2.16`'s bundle does `import … from 'react-reconciler/constants'`
(no extension). `react-reconciler` ships **no `exports` map** (CJS), so Node's ESM
loader can't resolve the bare subpath and throws
`ERR_MODULE_NOT_FOUND … Did you mean "react-reconciler/constants.js"?`.

This affects **any interactive TUI loaded under `node`** — e.g. taskmaster's
`connect` command, and potentially other apps' TUIs if ever run via node.

## Why it's low priority

The apps' bin shebangs run under **Bun**, whose resolver tolerates the
extensionless subpath, so TUIs work in normal use. The crash only manifests under
`node` (e.g. taskmaster's e2e harness spawns `node dist/cli.js`). HELM-T1
sidestepped it for taskmaster by lazy-loading the TUI + tsup `splitting`, so
non-interactive commands never load `@opentui/react` — but `connect` itself still
crashes under node.

## Options

- Upgrade `@opentui/react` to a version that emits extensionful / exports-aware
  imports (check >0.2.16).
- `pnpm patch react-reconciler` to add an `exports` map
  (`"./constants": "./constants.js"`, etc.) — fixes it for all consumers/runtimes.
- Run TUI commands only under Bun and document that `node` is unsupported for them.

## Acceptance criteria

- [ ] `node <app>/dist/cli.js <tui-command>` no longer throws the
      `react-reconciler/constants` resolution error, OR the node-incompatibility is
      explicitly documented and enforced.
