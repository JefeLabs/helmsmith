# toolz — Feature Overview

A categorized rundown of every CLI command and programmatic API
surface in toolz.

## CLI commands

### Branded banner

```bash
toolz
```

Prints the toolz banner + a list of common commands. Useful when you
forget what's available.

### Platform detection

```bash
toolz platform
```

Shows host OS, architecture, distribution (Linux), and the package
managers detected as available on this host.

```
Platform:
  OS:           darwin
  Architecture: arm64
  Package managers: brew (preferred)
```

Useful for debugging "why did toolz pick `apt` instead of `brew`?"
type questions.

### Check a tool

```bash
toolz check git
```

Reports whether `git` is installed, its path, version, and whether
toolz registered it:

```
✓ git
  Version:    2.45.0
  Path:       /opt/homebrew/bin/git
  Source:     registry
```

With `--min-version`:

```bash
toolz check git --min-version 2.40
```

Exits non-zero if the version is below the minimum (useful in scripts
gating on a tool's presence + version).

### Install a tool

```bash
toolz install jq
```

Picks the right package manager for your platform, installs `jq`,
records it in the registry. Output mirrors the package manager's
output so you can see what's happening.

#### Force a specific manager

```bash
toolz install fd --via apt
toolz install gh --via brew
```

Useful when you have multiple managers available and want to override
the default.

#### Dry run

```bash
toolz install pandoc --dry-run
```

Prints the install command toolz would run, without executing it.
Useful for confirming what's about to happen on a sensitive host.

### Ensure a tool (install if missing, version-gate)

```bash
toolz ensure git --min-version 2.40
```

Shorthand for "make sure git is installed, at least version 2.40,
auto-install if missing". Combines `check`, `install`, and version
gating into one CLI call.

```bash
toolz ensure git jq fd
```

Multi-tool form. Each tool's status is reported; non-zero exit if any
fail.

### List installed tools

```bash
toolz list
```

Prints every tool in the registry — what's installed, what version,
when it was registered.

```bash
toolz list --catalog
```

Prints every tool the **catalog** knows about (built-in + user
catalog). Useful for discovering "what does toolz know how to
install?".

### Doctor — drift reconciliation

```bash
toolz doctor
```

Walks the registry and verifies every entry against current filesystem
state:

```
✓ git@2.45.0 verified
✓ jq@1.7 verified
✗ fd registered but binary missing at /opt/homebrew/bin/fd
  → Re-install: toolz install fd
⚠ ripgrep version drift: registry says 14.0.0, filesystem has 14.1.0
  → toolz doctor --fix to refresh
```

Read-only by default. With `--fix`, refreshes registered versions
and removes entries for missing binaries. Doesn't reinstall — that's
your decision.

## Programmatic API

The library is the primary consumer surface. Other AgentX packages
that have CLI dependencies use these functions at startup.

### `ensureTool(name, options?)`

```typescript
import { ensureTool } from "@ecruz165/toolz";

const status = await ensureTool("git", {
  minVersion: "2.40.0",
  autoInstall: false,
  via: "brew",
});
```

Returns a `ToolStatus`:

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

**Never throws.** Even unrecoverable errors populate `error` instead
of escalating to an exception. This means:

```typescript
const { installed, error } = await ensureTool("nonexistent");
// error: "Tool 'nonexistent' not found in registry, on PATH, or in catalog"
```

…is a normal value to handle, not a try/catch concern.

### `ensureTools(toolsOrMap, defaults?)`

```typescript
// Array form — all tools share the same options
const statuses = await ensureTools(["git", "jq", "fd"], {
  autoInstall: true,
});

// Map form — per-tool options
const statuses = await ensureTools({
  git: { minVersion: "2.40.0" },
  jq:  { minVersion: "1.7" },
  fd:  { autoInstall: true },
});
```

Tools are checked in parallel where safe. Returns `ToolStatus[]` or
`Record<string, ToolStatus>` matching the input shape.

### Source field semantics

The `source` field tells consumers where the answer came from:

| Value | Meaning |
|---|---|
| `"registry"` | Fast-path cache hit. Trusted without re-probing. |
| `"found-on-path"` | Discovered on `PATH` and just registered for next time. |
| `"fresh-install"` | We just ran the package manager. |
| `"missing"` | Not installed. `error` field has details. |

Consumers can choose what to log: maybe `"fresh-install"` is worth a
"installed git" log line, but `"registry"` is silent.

## Catalog system

### Built-in catalog

Ships with descriptors for common tools:

- **Version control**: git, gh
- **Search/filter**: ripgrep, fd, fzf, jq, yq
- **Compression**: zstd, gzip, xz
- **Document conversion**: pandoc
- **Media**: ffmpeg, imagemagick
- **Network**: curl, wget, httpie
- **Data**: sqlite3, gron

(Specific list expands over time; `toolz list --catalog` shows
current contents.)

Each entry knows:

- Description
- Per-platform package name (e.g., `brew: ripgrep`, `apt: ripgrep`,
  `winget: BurntSushi.ripgrep.MSVC`)
- Version-parsing rule for `--version` output
- Optional homepage / related-tools metadata

### User catalog extensions

Add tools toolz doesn't know about (or override built-in entries) via
`~/.agentx/toolz/catalog.yaml`:

```yaml
tools:
  my-internal-cli:
    description: Internal company CLI
    packages:
      brew: my-org/tap/my-cli
      apt: my-org-cli
      winget: MyOrg.MyCli
  
  # Override built-in: use a custom brew tap
  ripgrep:
    packages:
      brew: my-org/tap/ripgrep-custom
```

User entries win over built-in entries by name.

## Configuration

### Storage location

`~/.agentx/toolz/` by default. Contents:

- `registry.yaml` — installed tools cache
- `catalog.yaml` — user catalog extensions (optional)

### Environment overrides

| Var | Purpose |
|---|---|
| `AGENTX_TOOLZ_DIR` | Override storage directory (used by tests + CI) |

Tests use a unique `AGENTX_TOOLZ_DIR` per test run so the user's real
`~/.agentx/toolz/` is never touched.

## Multi-platform support

| Platform | Status | Default manager | Alternates |
|---|---|---|---|
| macOS | ✅ shipped | brew | (port — planned) |
| Ubuntu/Debian | ✅ shipped | apt | (snap — planned) |
| Windows | ✅ shipped | winget | scoop, choco (planned) |
| Fedora/RHEL | ⏳ planned | dnf | |
| Arch | ⏳ planned | pacman | |

Adding a new package manager is a contained change: implement the
adapter interface in `src/platform/adapters/`, register it in
`package-managers.ts`, add catalog entries for the new platform.

## Common patterns

### Gate a script on tool versions

```bash
toolz ensure git --min-version 2.40 \
  && toolz ensure jq --min-version 1.7 \
  && ./your-script.sh
```

### Pre-flight check at the start of a script

```typescript
import { ensureTools } from "@ecruz165/toolz";

const { jq, gh, fd } = await ensureTools({
  jq: { minVersion: "1.7", autoInstall: true },
  gh: { minVersion: "2.40", autoInstall: true },
  fd: { autoInstall: false },
});

if (!jq.installed || !gh.installed) {
  console.error("Required tools missing. Run: toolz install jq gh");
  process.exit(1);
}
```

### Bulk install on a fresh machine

```bash
toolz install git jq fd ripgrep gh pandoc
```

### Check what's actually used by another package

```bash
# Inside a project that depends on tools:
grep -r "ensureTool\|ensureTools" node_modules/@agentx | sort -u
```

Combined with `toolz list --catalog`, this shows you the full set of
tools your stack expects.

## Testing utilities

`AGENTX_TOOLZ_DIR=<tmpdir>` makes toolz state-isolated for tests.
Combined with the package-manager adapters (which can be mocked),
you can write tests that exercise the full ensure logic without
touching the real filesystem or running real installs.

```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

beforeEach(() => {
  process.env.AGENTX_TOOLZ_DIR = mkdtempSync(`${tmpdir()}/toolz-test-`);
});
```

## Where to go from here

- **[getting-started.md](getting-started.md)** — install, basic
  commands, programmatic integration patterns.
- **[architecture.md](architecture.md)** — internal organization,
  platform/adapter design, registry semantics.
- **[executive-overview.md](executive-overview.md)** — high-level
  framing for stakeholders.
