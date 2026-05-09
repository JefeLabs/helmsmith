# toolz — Architecture

This document covers how toolz is organized internally — the platform
detector, package-manager adapters, registry, and ensure-tool API.

## High-level view

```
                     ┌─────────────────────────┐
                     │       toolz CLI          │
                     │     (Commander.js)       │
                     └────────────┬────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
        ┌─────▼──────┐                          ┌─────▼─────────┐
        │ Programmatic│                          │  Interactive  │
        │     API     │                          │   commands    │
        │ ensureTool  │                          │  check, list, │
        │ ensureTools │                          │  install,     │
        │             │                          │  doctor, etc. │
        └─────┬──────┘                          └─────┬─────────┘
              │                                       │
              └───────────────────┬───────────────────┘
                                  │
                          ┌───────▼────────┐
                          │   ensure.ts    │
                          │  (core logic)  │
                          └───────┬────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────────┐
        │                         │                             │
   ┌────▼─────┐              ┌────▼─────┐              ┌────────▼──────┐
   │  Registry│              │ Resolver │              │   Platform    │
   │ (YAML)   │              │ + Catalog│              │   detect /    │
   │          │              │          │              │   adapters    │
   └──────────┘              └──────────┘              └───────────────┘
   ~/.agentx/toolz/         catalog.yaml +              brew / apt /
   registry.yaml             built-in defaults          winget / etc.
```

## Components

### Platform detection (`src/platform/`)

Detects the host environment at runtime:

- **OS family** (`darwin`, `linux`, `windows`)
- **Architecture** (`x64`, `arm64`)
- **Distribution** (Linux only — `ubuntu`, `debian`, `fedora`, `arch`,
  etc., parsed from `/etc/os-release`)
- **Available package managers** in priority order

The detector populates a `Platform` struct that downstream adapters
consume. It runs once at process start; results are cached for the
lifetime of the process.

### Package-manager adapters (`src/platform/adapters/`)

Each adapter knows how to:

- Check if its package manager is available on the host
- Install a package by name
- Uninstall
- Query installed version (where supported)

Shipped adapters: **brew**, **apt**, **winget**.
Planned: **dnf**, **pacman**, **scoop**, **choco**.

The adapter-selection logic in `package-managers.ts` picks the right
adapter for the platform. On macOS that's nearly always brew; on
Linux it depends on the distro; on Windows winget is preferred over
scoop when both exist.

Users can force a specific adapter with `toolz install <pkg> --via apt`.

### Tool checker (`src/core/tool-checker.ts`)

Determines whether a tool is currently installed on `PATH`:

```typescript
const result = await checkTool("git", { minVersion: "2.40.0" });
// {
//   name: "git",
//   installed: true,
//   version: "2.45.0",
//   path: "/opt/homebrew/bin/git",
//   versionTooLow: false,
// }
```

Implementation:

1. `which <tool>` (or `where` on Windows) to find the binary
2. `<tool> --version` to parse the version string
3. Compare against `minVersion` if provided (using semver semantics)

Version parsing is tool-aware where needed — different tools format
their `--version` output differently. The catalog declares each
tool's version-parsing approach.

### Registry (`src/config/`)

Persistent state at `~/.agentx/toolz/registry.yaml`:

```yaml
version: 1
tools:
  git:
    version: "2.45.0"
    path: /opt/homebrew/bin/git
    registeredAt: "2026-05-09T10:00:00Z"
    source: fresh-install
  jq:
    version: "1.7"
    path: /opt/homebrew/bin/jq
    registeredAt: "2026-05-09T10:01:00Z"
    source: found-on-path
```

The registry is a **cache**, not the source of truth. The source of
truth is the actual filesystem state. The registry exists so:

- `ensureTool` can short-circuit "is it installed?" without re-probing
  the filesystem on every check (matters when called from many
  packages at startup)
- `toolz list` is fast
- We have a record of where toolz-installed tools came from

`toolz doctor` is the read-only reconciliation step that catches when
the registry has drifted from reality.

### Catalog (`src/core/built-in-catalog.ts` + user catalog)

Defines what tools toolz knows about, including:

- Display name + description
- How to install on each platform (`packages` map)
- How to parse the version output
- Optional metadata (homepage, related tools)

```typescript
const builtInCatalog = {
  git: {
    description: "Distributed version control",
    packages: {
      brew: "git",
      apt: "git",
      dnf: "git",
      pacman: "git",
      winget: "Git.Git",
    },
    versionRegex: /git version (\S+)/,
  },
  // ...
}
```

Users override or extend via `~/.agentx/toolz/catalog.yaml`. Merge
order: user catalog wins over built-in for any conflicting key.

### Tool resolver (`src/core/tool-resolver.ts`)

Combines the registry, catalog, and live filesystem state into a
single coherent answer:

1. If registry says installed → trust it (fast path)
2. Else, check filesystem (`tool-checker`) → if found, register it
3. Else, look up in catalog → if installable + `autoInstall: true`,
   run the install adapter
4. Re-check filesystem → register and return

### Ensure (`src/core/ensure.ts`)

The high-level API. Wraps the resolver with structured error
handling, never throwing, returning a `ToolStatus` for every input.
Two functions:

- `ensureTool(name, options)` — single tool
- `ensureTools(names | options-map, defaults)` — multiple tools,
  parallel-safe

Both honor:

- `minVersion` — semver gate
- `autoInstall` — install if missing
- `via` — force a specific package manager

### Doctor (`src/core/doctor.ts`)

Walks every registry entry and verifies:

- The recorded path still exists
- The path is still on `PATH`
- The version on disk matches what we recorded (warns on drift)
- The recorded package manager still has the tool installed (catches
  manual `brew uninstall`s)

Reports issues without auto-fixing. Suggested remediations are
printed alongside each finding.

## Data flow — `ensureTool`

```
ensureTool("jq", { minVersion: "1.7" })
        │
        ▼
   ┌────────────┐
   │ Registry   │  registry.yaml has jq?
   │ lookup     │
   └─────┬──────┘
         │
   ┌─────▼──────┐
   │ Yes? → return ToolStatus { source: "registry" }
   └─────┬──────┘
         │ No
         ▼
   ┌────────────┐
   │ Filesystem │  `which jq` succeeds?
   │ check      │
   └─────┬──────┘
         │
   ┌─────▼──────────────────┐
   │ Yes? → register +       │
   │ return { source:        │
   │ "found-on-path" }       │
   └─────┬───────────────────┘
         │ No
         ▼
   ┌────────────┐
   │ autoInstall│
   │   true?    │
   └─────┬──────┘
         │
   ┌─────▼──────────┐
   │ Yes? → catalog │  → install via package manager
   │  + adapter     │  → re-check filesystem
   │                │  → register + return { source:
   │                │    "fresh-install" }
   └─────┬──────────┘
         │ No, or install failed
         ▼
   return ToolStatus { installed: false, source: "missing", error: "..." }
```

## Configuration model

### Persistent state

`~/.agentx/toolz/` (override with `AGENTX_TOOLZ_DIR=/path` for tests
and CI):

- `registry.yaml` — cached "what's installed where" state
- `catalog.yaml` — user catalog extensions

### Environment variables

| Var | Purpose |
|---|---|
| `AGENTX_TOOLZ_DIR` | Override the `~/.agentx/toolz/` location |

### CLI flags

| Flag | Purpose |
|---|---|
| `--via <manager>` | Force a specific package manager |
| `--dry-run` | Print what would happen without executing |
| `--min-version <v>` | Verify presence + minimum version |

## Why these choices

### Why a registry cache (instead of always re-probing)

When 5 AgentX packages each call `ensureTool` at startup, re-probing
the filesystem every time is wasteful. The registry trades a small
correctness risk (registry could drift from reality) for a meaningful
startup-time win. `toolz doctor` is the explicit reconciliation
mechanism — drift is correctable, just not automatic.

### Why never throw from `ensureTool`

Throwing forces every consumer into try/catch ceremony for a
predictable failure mode (tool missing). Returning a structured
`ToolStatus` with an `error` field makes the missing case ergonomic
to handle:

```typescript
const { installed, error } = await ensureTool("jq");
if (!installed) {
  // surface error in your tool's output
}
```

### Why YAML for storage (not JSON)

Registry files are read by humans during debugging more often than
they're parsed by code. YAML's comment support and unquoted keys
make registry inspection less painful. For programs that prefer
JSON, the registry is parsed-and-re-emitted by toolz itself — no
external consumer should be reading the YAML directly.

### Why a built-in catalog instead of "always look up online"

Catalog lookups during a tool's startup would add network latency
and a failure mode to every consuming package. The built-in catalog
covers ~95% of common tools; the user catalog handles everything
else. No internet required.

### Why `--via` overrides

Some tools have multiple install paths (e.g., gh via brew vs apt vs
the official tarball). When a team standardizes on one path,
`--via brew` makes that explicit. Default selection works for
greenfield setups; `--via` is the escape hatch for shops with
existing conventions.

## Repository layout

```
apps/toolz/
├── bin/
│   └── toolz.mjs                 # Node shim that loads dist/index.js
├── src/
│   ├── cli.ts                    # Commander entry; registers subcommands
│   ├── index.ts                  # Programmatic API exports
│   ├── platform/
│   │   ├── detect.ts             # OS / arch / distro detection
│   │   ├── package-managers.ts   # adapter selection logic
│   │   ├── adapters/             # brew, apt, winget impls
│   │   └── types.ts
│   ├── core/
│   │   ├── tool-checker.ts       # filesystem probe
│   │   ├── tool-resolver.ts      # registry + catalog merge
│   │   ├── ensure.ts             # high-level API
│   │   ├── doctor.ts             # drift reconciliation
│   │   ├── built-in-catalog.ts
│   │   └── *.test.ts
│   ├── config/                   # YAML registry + catalog IO
│   └── ui/                       # CLI banner + chalk-styled output
├── dist/                         # tsup build output
└── docs/                         # this directory
```
