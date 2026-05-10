# 🔧 @ecruz165/toolz

Cross-platform tool manager for the AgentX ecosystem. Detects whether a
CLI tool is installed, parses its version, installs missing tools via
the platform's package manager, and registers everything in a central
manifest. Designed to be consumed by other AgentX packages that
declare CLI dependencies.

Part of the [agentx-toolbox](../..) monorepo.

## Quick start

```bash
toolz                                # Branded banner + common commands
toolz platform                       # Show host OS / arch / distro
toolz check git                      # Is git installed? Path? Version?
toolz install jq                     # Install via auto-selected manager
toolz install fd --via apt           # Force a specific manager
toolz install pandoc --dry-run       # Preview without executing
toolz ensure git --min-version 2.40  # Verify presence + semver gate
toolz list                           # All tools in the registry
toolz list --catalog                 # All tools known to the catalog
toolz doctor                         # Reconcile registry vs reality
```

## Programmatic API

The primary consumer of `@ecruz165/toolz` is **other AgentX packages**:

```typescript
import { ensureTool, ensureTools } from "@ecruz165/toolz";

// One tool, fail if missing
const status = await ensureTool("git", { minVersion: "2.40.0" });
if (!status.installed) {
  console.error(`git missing: run \`toolz install git\``);
  process.exit(1);
}

// Multiple tools, auto-install missing
const statuses = await ensureTools(["git", "gh", "jq"], {
  autoInstall: true,
});

// Per-tool options
await ensureTools({
  git: { minVersion: "2.40.0" },
  gh: { autoInstall: true },
});
```

`ensureTool` never throws — every failure mode populates a structured
`ToolStatus` with `error` and `source`:

```typescript
interface ToolStatus {
  name: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  registeredAt: string | null;
  source: "registry" | "found-on-path" | "fresh-install" | "missing";
  versionTooLow: boolean;
  error?: string;
}
```

Source values let consumers decide what to log: `"registry"` is the
fast-path cache hit; `"found-on-path"` means the tool was discovered
and registered for next time; `"fresh-install"` means we just ran the
package manager.

## How the registry works

Persistent state lives at `~/.agentx/toolz/` (override with
`AGENTX_TOOLZ_DIR=/path` for tests / CI):

- `registry.yaml` — installed tools + version + path + when installed
- `catalog.yaml` — user catalog extensions (merges with built-in)

`ensureTool` trusts the registry without re-probing for speed.
`toolz doctor` is the read-only counterpart that validates every entry
against reality (path existence, PATH drift, version drift, packages
removed via raw `brew uninstall` outside ToolZ).

## Catalog

The built-in catalog ships with common tools (git, gh, jq, yq,
ripgrep, fd, pandoc, ffmpeg). To add your own:

```yaml
# ~/.agentx/toolz/catalog.yaml
tools:
  my-tool:
    description: Custom internal tool
    packages:
      brew: my-tool
      apt: my-tool-apt-name
      winget: MyOrg.MyTool
```

User entries override built-in entries with the same name.

## Stack

Per [agentx-toolbox stack conventions](../../README.md):

- TypeScript ESM
- Commander.js for CLI parsing
- vitest for tests
- tsup for bundling
- chalk for colored output
- yaml for config files

## Roadmap

The implementation plan walks through 7 phases:

1. ✅ Scaffolding & platform detection
2. ✅ Tool checking & version parsing
3. ✅ Package manager adapters (brew, apt, winget; dnf/pacman/scoop/choco future)
4. ✅ Registry & user catalog
5. ✅ Core `ensureTool` API
6. ✅ Doctor command — registry reconciliation
7. ✅ Branding & polish

## Development

```bash
# From the toolbox root:
npm install
npm test --workspace=@ecruz165/toolz
npm run build --workspace=@ecruz165/toolz

# From this directory:
npm test
npm run build           # tsup → dist/
npm run dev             # watch mode
```

Tests use `AGENTX_TOOLZ_DIR=<tmpdir>` per test for state isolation —
the user's real `~/.agentx/toolz/` is never touched during the suite.
