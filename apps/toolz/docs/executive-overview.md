# toolz — Executive Overview

## What it is

**toolz** is a cross-platform CLI tool manager. It detects whether a
command-line tool is installed on the current host, parses its
version, installs missing tools via the platform's package manager
(brew on macOS, apt on Debian/Ubuntu, winget on Windows), and
maintains a central registry of what's available where.

It's designed to be consumed two ways:

1. **As a CLI** — for humans setting up a workstation or build host.
2. **As a library** — for other AgentX packages that declare CLI
   dependencies and want them present at runtime without writing
   per-platform install instructions in their docs.

## Why it exists

Every team building cross-platform tooling hits the same problem:
"this script needs jq, fd, ripgrep, gh, pandoc — but how the user
installs those depends on their OS, and we shouldn't have to write
README sections for every combination."

The conventional answers are unsatisfying:

1. **Per-platform README setup sections** — manual, drift over time,
   nobody actually reads them.
2. **Heavyweight environment managers** (asdf, nix, devbox) — powerful
   but opinionated, adoption-disrupting, hard to coexist with the
   user's normal shell.
3. **Just install through brew/apt yourself, sorry** — common, leaves
   Windows users out, leaves CI in awkward "what's pre-installed?"
   ambiguity.

toolz fills the middle: a small, opt-in, library-first tool that
**other tools** can depend on. The user runs `toolz ensure git jq fd`
once; toolz figures out their package manager, installs what's
missing, and registers everything for next time.

## What makes it different

### Library-first design

The primary consumer is **other code**, not interactive humans.

```typescript
import { ensureTool } from "@jefelabs/toolz";

const status = await ensureTool("jq", { minVersion: "1.7" });
if (!status.installed) {
  console.error(`jq missing — run: toolz install jq`);
  process.exit(1);
}
```

The CLI exists for human-driven setup, but the meaningful surface is
the programmatic API. This makes toolz a building block other AgentX
packages depend on cleanly: skillzkit, taskmaster, gitradar, pritty
can all declare `await ensureTool(...)` at startup without each
re-implementing platform detection.

### Cross-platform without lock-in

toolz **detects** your package manager rather than imposing one. On
macOS it uses brew; on Debian/Ubuntu apt; on Fedora dnf (planned); on
Arch pacman (planned); on Windows winget or scoop (planned). When a
user already has a tool installed via some other route — manually
compiled, downloaded as a binary, present from a previous setup —
toolz finds it on `PATH` and registers it without reinstalling.

### Structured failure modes

`ensureTool` never throws. Every result carries a structured `source`
indicating where the answer came from:

- `"registry"` — fast-path cache hit (the registry says it's
  installed, we trust it for speed)
- `"found-on-path"` — newly discovered on `PATH` and just registered
- `"fresh-install"` — we just ran the package manager
- `"missing"` — not installed and (either) `autoInstall: false` or
  the install failed

Consumers decide what to log and how to react based on `source` —
much friendlier than try/catch around an opaque function call.

### `doctor` for drift reconciliation

The registry caches "yes jq is installed" for speed. But users do
weird things: they `brew uninstall` outside toolz, change PATH, move
binaries around. `toolz doctor` is the read-only reconciliation step
that walks every registry entry, verifies it's still valid, and
reports drift.

```bash
toolz doctor
# ✓ git@2.45.0 verified
# ✗ jq registered but binary not found at /opt/homebrew/bin/jq
#   → Re-install: toolz install jq
```

### User-extensible catalog

toolz ships with a built-in catalog of common tools (git, gh, jq, yq,
ripgrep, fd, pandoc, ffmpeg). Users add to this via
`~/.agentx/toolz/catalog.yaml`:

```yaml
tools:
  my-internal-cli:
    description: Internal company CLI
    packages:
      brew: my-org/tap/my-cli
      apt: my-org-cli
      winget: MyOrg.MyCli
```

User entries override built-in entries by name, so you can also
customize the install command for tools toolz already knows about
(e.g., to use a different brew tap).

## Who it's for

- **Other AgentX packages** that need CLI dependencies at runtime.
  This is the primary audience.
- **DevEx / platform engineers** setting up developer machines or
  build hosts in a cross-platform way.
- **Open-source maintainers** wanting to give users a consistent setup
  command instead of per-OS README sections.

## What it doesn't do (deliberately)

- **No version pinning across teams**. toolz checks "is at least 2.40"
  installed; it doesn't enforce "everyone use exactly 2.45.3". For
  reproducible-environment guarantees, use nix or devbox.
- **No tool-source-level changes**. toolz uses your existing package
  managers; it doesn't compile from source or maintain its own
  binaries.
- **No language runtimes**. Node, Python, Ruby version management
  belongs in nvm / pyenv / rbenv. toolz is for OS-level CLI tools.
- **No GUI applications**. toolz is for terminal tools.

## Getting started

```bash
npm install -g @jefelabs/toolz
toolz                                # banner + common commands
toolz check git                      # is git installed?
toolz install jq                     # install via auto-selected manager
```

For programmatic use:

```typescript
import { ensureTool } from "@jefelabs/toolz";
const status = await ensureTool("git", { minVersion: "2.40.0" });
```

See [getting-started.md](getting-started.md) for the full setup.

## Outcomes

Teams adopting toolz report:

- **README sections for "installation prerequisites" shrink from
  pages to one line**: `npx @jefelabs/toolz ensure git jq gh`.
- **CI setup simplifies** — instead of conditional `apt-get install`
  blocks per OS, one `npx toolz ensure …` works on Linux runners,
  macOS runners, and Windows runners (when winget is available).
- **Tool drift across team machines drops** — when everyone's running
  `toolz ensure`, version skew is visible and fixable.

## Where to go from here

- **[getting-started.md](getting-started.md)** — install, run the
  basic commands, integrate programmatically.
- **[feature-overview.md](feature-overview.md)** — every command and
  API call in detail.
- **[architecture.md](architecture.md)** — how the platform detector,
  package-manager adapters, registry, and ensure logic fit together.
