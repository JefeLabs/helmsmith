# HELM-T5: @opentui/react@0.2.16 extensionless ESM import breaks under Node

**Labels:** `bug` · `upstream` · `area:tui` · `low-priority`
**Status:** Open
**CI exclusion:** none (no test exercises an interactive TUI at runtime)

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
