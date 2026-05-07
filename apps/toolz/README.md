# @agentx/toolz

ToolZ — cross-platform tool manager for the AgentX ecosystem. Detects
whether a CLI tool is installed, parses its version, installs missing
tools via the platform's package manager, and registers everything in
a central manifest.

> **Status**: Phase 1 + 2 of the [implementation plan](../../../agentx-toolz/toolz-implmentation-plan.md)
> are landed (scaffolding, platform detection, tool checking). Package
> manager adapters, registry, and the `ensure` API are next.

Part of the [agentx-toolbox](../..) monorepo.

## Quick start

```bash
toolz platform                    # Show host OS / arch / distro
toolz check git                   # Is git installed? At what version?
toolz check node                  # Same for any tool on PATH
```

## Programmatic API

```typescript
import { checkTool, detectPlatform } from "@agentx/toolz";

const info = detectPlatform();
// → { platform: "darwin", arch: "arm64", isWSL: false }

const git = await checkTool("git");
// → { installed: true, path: "/usr/bin/git", version: "2.43.0" }
```

## Roadmap

The implementation plan walks through 7 phases:

1. ✅ Scaffolding & platform detection (this commit)
2. ✅ Tool checking & version parsing (this commit)
3. ⏳ Package manager adapters (brew, apt, dnf, pacman, winget, scoop, choco)
4. ⏳ Registry & catalog (`~/.agentx/toolz/registry.yaml`)
5. ⏳ Core `ensure` API (`ensureTool`, `ensureTools`)
6. ⏳ Full CLI commands (install, list, register, doctor, ...)
7. ⏳ Branding & polish

## Stack

Per [agentx-toolbox stack conventions](../../README.md):

- TypeScript ESM
- Commander.js for CLI parsing
- vitest for tests
- tsup for bundling (publishable CLI artifact)

## Development

```bash
# From the toolbox root:
npm install              # workspace deps
npm test                 # all apps including toolz

# From this app:
npm test                 # just toolz tests
npm run build            # tsup → dist/
npm run dev              # watch mode
```
