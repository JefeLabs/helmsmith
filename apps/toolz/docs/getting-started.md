# Getting Started — toolz

This guide takes you from zero to a working toolz install in about 5
minutes, then walks two paths:

1. **CLI usage** — for setting up your own machine.
2. **Programmatic use** — for integrating toolz into another package
   that has CLI dependencies.

## Prerequisites

- **Node.js ≥ 20**. Check with `node --version`.
- **A package manager available on your platform**:
  - macOS: [Homebrew](https://brew.sh)
  - Debian/Ubuntu: `apt` (built-in)
  - Windows: [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/) (Windows 10+ comes with it)
  - Fedora/Arch: planned support; for now you'll need to install tools
    manually and let toolz discover them on `PATH`.

## 1. Install

```bash
npm install -g @agentx/toolz
```

Verify:

```bash
toolz --version
# 0.0.1 (or current version)
```

If you see "command not found", the npm global bin isn't on your
`PATH`. Add `$(npm bin -g)` or use `npx toolz …`.

## 2. Confirm your platform

```bash
toolz platform
```

Output should look like:

```
Platform:
  OS:           darwin
  Architecture: arm64
  Distribution: (not applicable on macOS)
  Package managers detected:
    ✓ brew (preferred)
```

If your package manager isn't detected, install it first (e.g.,
[install Homebrew](https://brew.sh) on macOS) and re-run.

## 3. Check what's already installed

```bash
toolz check git
toolz check jq
toolz check fd
```

For each tool, you'll see one of:

- ✓ Installed (with version + path)
- ✗ Not installed

This populates the registry as a side-effect — toolz finds tools on
`PATH` and records them so future checks are fast.

## 4. Install missing tools

```bash
toolz install jq
```

toolz picks the right package manager and runs the install. Output
mirrors the package manager's output so you can see what's happening:

```
Installing jq via brew...
==> Downloading https://...
==> Pouring jq--1.7....bottle.tar.gz
✓ Installed jq@1.7 at /opt/homebrew/bin/jq
```

For a dry run:

```bash
toolz install pandoc --dry-run
# Would run: brew install pandoc
```

For multiple tools:

```bash
toolz install git jq fd ripgrep gh
```

## 5. Use `ensure` for "install if missing"

`ensure` combines check + install + version-gate into one command:

```bash
toolz ensure git --min-version 2.40
```

Idempotent: if git is already installed and ≥ 2.40, no-op. Otherwise
installs (or upgrades, where supported).

## 6. List what's been registered

```bash
toolz list
```

Shows every tool toolz knows is installed:

```
Tools (5):
  git@2.45.0           /opt/homebrew/bin/git           registry
  jq@1.7               /opt/homebrew/bin/jq            fresh-install
  fd@8.7.0             /opt/homebrew/bin/fd            found-on-path
  ripgrep@14.0.0       /opt/homebrew/bin/rg            fresh-install
  gh@2.45.0            /opt/homebrew/bin/gh            registry
```

The `source` column shows where the registry entry came from:

- `registry` — was already known
- `found-on-path` — discovered the binary on `PATH` and registered
- `fresh-install` — toolz just installed it

## 7. Check for drift

```bash
toolz doctor
```

Walks every registry entry and verifies it against the current
filesystem:

```
✓ git@2.45.0 verified
✓ jq@1.7 verified
✓ fd@8.7.0 verified
✗ ripgrep registered but binary missing at /opt/homebrew/bin/rg
  → Re-install: toolz install ripgrep
⚠ gh version drift: registry says 2.45.0, filesystem has 2.46.0
  → toolz doctor --fix to refresh
```

Read-only by default. With `--fix`, refreshes recorded versions for
drift-only cases and removes entries for missing binaries (without
reinstalling — you decide).

---

## Path B — Programmatic integration

If you're building another AgentX package (or any Node tool) that
needs CLI dependencies at runtime, integrate toolz programmatically.

### Install as a dependency

```bash
npm install @agentx/toolz
```

### Add a startup check

In your tool's entry point:

```typescript
import { ensureTool } from "@agentx/toolz";

async function main() {
  // Single tool, fail if missing
  const git = await ensureTool("git", { minVersion: "2.40.0" });
  if (!git.installed) {
    console.error(
      `git is required (≥ 2.40.0). Run: toolz install git`,
    );
    console.error(`  Detail: ${git.error}`);
    process.exit(1);
  }

  // Your tool's logic here
}

main();
```

### Multi-tool check with auto-install

```typescript
import { ensureTools } from "@agentx/toolz";

const statuses = await ensureTools(
  ["git", "jq", "gh"],
  { autoInstall: true },
);

const missing = statuses.filter((s) => !s.installed);
if (missing.length > 0) {
  console.error(`Missing tools: ${missing.map((s) => s.name).join(", ")}`);
  for (const tool of missing) console.error(`  ${tool.name}: ${tool.error}`);
  process.exit(1);
}
```

### Per-tool options

```typescript
const statuses = await ensureTools({
  git: { minVersion: "2.40.0" },
  jq:  { minVersion: "1.7", autoInstall: true },
  gh:  { autoInstall: true },
});
```

Returns `Record<string, ToolStatus>` matching the input shape — same
keys, statuses as values.

### React to source

```typescript
const status = await ensureTool("jq");
switch (status.source) {
  case "registry":
    // No log — fast-path hit
    break;
  case "found-on-path":
    console.log(`Found jq on PATH; registered for next time`);
    break;
  case "fresh-install":
    console.log(`Just installed jq@${status.version}`);
    break;
  case "missing":
    console.error(`jq missing: ${status.error}`);
    break;
}
```

## Customizing the catalog

If you need a tool toolz doesn't know about (or want to override how
toolz installs a tool), edit `~/.agentx/toolz/catalog.yaml`:

```yaml
tools:
  my-internal-cli:
    description: Internal company CLI
    packages:
      brew: my-org/tap/my-cli
      apt: my-org-cli-pkg
      winget: MyOrg.MyCli

  # Override the built-in ripgrep entry
  ripgrep:
    packages:
      brew: my-org/tap/ripgrep-custom
```

Then `toolz install my-internal-cli` works just like any built-in.

User catalog entries override built-in entries by name.

## Common workflows

### Set up a fresh machine for a project

If your project's README has a "Prerequisites" section, replace it
with:

```bash
npx @agentx/toolz ensure git jq gh fd ripgrep --min-version 2.40
```

One command across macOS, Linux, and Windows. (Pin specific versions
where it matters.)

### Use in CI

Most CI runners come with various tools pre-installed. toolz finds
them on `PATH` (no install needed) and registers them:

```yaml
# .github/workflows/test.yml
- run: npx @agentx/toolz ensure git jq gh
```

If the runner is missing a tool, toolz installs it via the available
package manager.

### Test against a clean state

For tests of code that uses toolz programmatically:

```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

beforeEach(() => {
  process.env.AGENTX_TOOLZ_DIR = mkdtempSync(`${tmpdir()}/toolz-test-`);
});

afterEach(() => {
  delete process.env.AGENTX_TOOLZ_DIR;
});
```

Each test gets a fresh registry/catalog state without touching the
user's real config.

## Troubleshooting

### "No package manager available on this platform"

You're on a platform whose package manager isn't shipped yet (e.g.,
Fedora's dnf is planned but not in this version), OR your platform's
manager isn't installed (e.g., Homebrew on macOS).

Workaround: install the tool manually via your usual method, and
toolz will find it on `PATH`:

```bash
# Install jq however your platform handles it
toolz check jq           # toolz will find + register it
```

### "Tool 'X' not found in catalog"

The catalog doesn't know about tool X. Either:

1. Add it to `~/.agentx/toolz/catalog.yaml`:

```yaml
tools:
  X:
    packages:
      brew: x-formula
      apt: x-package
```

2. Or just install it manually and use `toolz check X` to register.

### Registry shows installed but `toolz check` says missing

The binary moved or was uninstalled outside toolz. Run:

```bash
toolz doctor
```

…to find drift and `toolz doctor --fix` to clean up the registry.

### Reset everything

```bash
rm -rf ~/.agentx/toolz/
```

Next `toolz check` or `toolz install` recreates the directory.

## What's next

- **[feature-overview.md](feature-overview.md)** — every command and
  API surface in detail.
- **[architecture.md](architecture.md)** — internal organization,
  package-manager adapter design, registry semantics.
- **[executive-overview.md](executive-overview.md)** — high-level
  framing for stakeholders.
