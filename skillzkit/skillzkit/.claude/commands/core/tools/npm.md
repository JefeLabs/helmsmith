---
description: npm package manager for Node.js. CLI only — no MCP. The most heavily-used tool in the suite — every Node-based project depends on it for installing tools, building applications, publishing packages. Used by /engineer:maintenance:upgrades:npm-deps and consumed implicitly by every other Node tool's invocation.
argument-hint: <free-form-prompt> [<command>] [--save-dev] [--save-exact] [--workspace <name>]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of npm for Node.js package management,
script execution, and publishing operations. The most-invoked
tool in the suite given that most consumed tools (Playwright,
pixelmatch, ESLint, Biome, Chromatic, etc.) are themselves
npm packages.

## Phase 0: pre-flight

1. Verify npm active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.npm.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "npm not active. Run /core:tools:setup npm"
     exit 1
   fi
   ```

2. Verify npm is invokable:

   ```bash
   if ! command -v npm >/dev/null 2>&1; then
     echo "npm not installed. Install Node.js first:"
     echo "  https://nodejs.org/ or via nvm/fnm/asdf"
     exit 1
   fi
   
   NODE_VER=$(node --version 2>&1)
   NPM_VER=$(npm --version 2>&1)
   echo "Node: $NODE_VER, npm: $NPM_VER"
   ```

3. Verify project has package.json (for project operations):

   ```bash
   PROJECT_ROOT=$(jq -r '.tools.npm.projectRoot // "."' \
                       product/.pencil-tools.json)
   
   # Most operations need package.json; some don't (npm view, npm install -g)
   ```

## Phase 1: prompt interpretation

npm operations:

### Package operations

- **install** — install all dependencies from package.json
- **install <pkg>** — add a specific package
- **install --save-dev** — add as dev dependency
- **install --save-exact** — pin exact version (no ^ prefix)
- **install -g <pkg>** — global install
- **uninstall <pkg>** — remove a package
- **update** — update to latest matching package.json semver
- **outdated** — list packages with newer versions available

### Script operations

- **run <script>** — execute scripts defined in package.json
- **start, test, build** — special script aliases
- **list scripts** — `npm run` (no args)

### Publish operations

- **publish** — publish package to npm registry
- **version** — bump version (patch/minor/major) and tag
- **login / logout / whoami** — auth state

### Inspection

- **view <pkg>** — package metadata
- **ls** — installed dependencies tree
- **ls --depth=0** — direct dependencies only
- **audit** — vulnerability scan
- **why <pkg>** — explain why a transitive dep is included

### Workspace operations

- **install --workspaces** — install for all workspaces
- **run <script> --workspace <name>** — run script in
  specific workspace

## Phase 2: execution

### Standard install

```bash
# Project install (reads package.json)
cd "$PROJECT_ROOT" && npm install

# Add a package
npm install --save-dev @biomejs/biome

# Add with exact version pin
npm install --save-exact --save-dev @biomejs/biome@1.9.4

# Production-only (skip devDependencies; CI / Docker)
npm install --omit=dev
```

### Update strategies

```bash
# Update within semver range (patch/minor only by default)
npm update

# Specific package
npm update @biomejs/biome

# See what would update
npm outdated

# Force major updates (requires explicit version)
npm install @biomejs/biome@latest
```

### Scripts

```bash
# Run defined script
npm run build
npm run test
npm run lint

# Special aliases
npm test    # same as: npm run test
npm start   # same as: npm run start

# List available scripts
npm run
```

### Publish operations

```bash
# Bump version (creates git tag if in git repo)
npm version patch   # 1.2.3 → 1.2.4
npm version minor   # 1.2.3 → 1.3.0
npm version major   # 1.2.3 → 2.0.0

# Publish to npm registry
npm publish

# Publish with public access (scoped packages default to private)
npm publish --access public

# Dry run (test without actually publishing)
npm publish --dry-run
```

### Workspaces

For monorepo workspaces (skillz-suite is one such monorepo
when published):

```bash
# Install across all workspaces
npm install

# Install dependency in specific workspace
npm install lodash --workspace=@jefelabs/skillz-engineer

# Run script in specific workspace
npm run build --workspace=@jefelabs/skillz-product

# Run across all workspaces
npm run build --workspaces

# Workspace-aware ls
npm ls --workspaces
```

### Inspection

```bash
# Package metadata
npm view react

# Installed dependencies (top level only)
npm ls --depth=0

# Why is X installed?
npm why jackson-databind  # actually doesn't apply to JS;
                           # use 'npm why' for JS deps:
npm why react

# Audit for vulnerabilities
npm audit

# Auto-fix safe vulnerabilities
npm audit fix

# Aggressive (may break things)
npm audit fix --force
```

## Phase 3: result formatting

### Install summary

```
=== npm install ===
Project:   skoolscout-app-ui
Lockfile:  package-lock.json (npm)

Dependencies installed: 1,247 packages (143 direct)
Duration:  47s

Warnings:
  3 packages with deprecated transitive deps (acceptable;
  no direct equivalents)

Status: SUCCESS
```

### Outdated summary

```
=== npm outdated ===
Project: skoolscout-app-ui

Major version updates (manual review):
  react              18.3.1 → 19.0.0
  react-dom          18.3.1 → 19.0.0
  next               14.2.5 → 15.0.0
  
Minor updates (typically safe):
  @types/node        20.14.0 → 20.16.0
  typescript         5.5.3  → 5.6.0
  
Patch updates (safe):
  @biomejs/biome     1.9.3  → 1.9.4
  ... (12 more)

To update:
  Patches/minors: /engineer:maintenance:upgrades:npm-deps --tier minor
  Majors: requires migration plan
```

### Audit findings

```
=== npm audit ===
Project: skoolscout-app-ui

Vulnerabilities:
  Critical:  0
  High:      2
  Moderate:  5
  Low:       3

Critical / High issues:
  axios@<1.7.4 — Server-Side Request Forgery
    Path: skoolscout-app-ui > axios@1.7.0
    Fix: npm install axios@^1.7.4
  
  semver@<7.5.2 — Regular expression denial of service
    Path: many transitive
    Fix: npm audit fix

To resolve:
  Auto-fix safe: npm audit fix
  Force-fix (may break): npm audit fix --force (review first)
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| `EACCES` / permission denied | Global install needs sudo | Use a Node version manager (nvm, fnm) instead of system Node |
| `EEXIST` | Path conflict | Clear node_modules and reinstall: `rm -rf node_modules && npm install` |
| Lockfile out of sync | package.json changed without install | `npm install` to sync |
| Network timeout | Slow registry or proxy issue | Check ~/.npmrc; configure registry mirror if needed |
| Peer dependency conflict | Incompatible peer deps | Review the conflict; sometimes needs `--legacy-peer-deps` (npm 7+) |
| Engine warning | Node version doesn't match `engines` | Update Node to match, or remove `engines` field if too strict |

## Cross-namespace integration

npm is consumed by:

- **`engineer/maintenance/upgrades/npm-deps`** — npm dependency
  upgrade routine
- **`engineer/maintenance/upgrades/node-version`** — Node
  version coordination
- **Tool installation** — most tools in the registry are npm
  packages; setup commands invoke `npm install`
- **Build verification in upgrade routines** — after applying
  changes, `npm run build` to verify
- **Publishing @jefelabs packages** — `npm publish --access public`
  for the skillz-suite ecosystem
- **Bumpr** — orchestrates npm across multiple repos

## What this tool does NOT do

- **Replace pnpm or yarn.** When projects use pnpm or yarn,
  use those tools (separate tool entries when added). The
  suite detects which package manager via lockfile presence
  (package-lock.json = npm, yarn.lock = yarn,
  pnpm-lock.yaml = pnpm).
- **Manage Node version.** Use nvm, fnm, asdf, or volta.
- **Configure npm settings.** ~/.npmrc, scoped registries,
  auth tokens — user-managed.
- **Edit package.json directly.** `npm install --save` modifies
  it via npm; manual JSON edits are user/agent work.
- **Manage monorepo tools.** Lerna, Turborepo, Nx are separate
  tools; npm workspaces is the built-in alternative.

## Examples

```bash
# Install all dependencies
/core:tools:npm "install dependencies"

# Add a dev dependency with exact version
/core:tools:npm "add @biomejs/biome as exact dev dependency"

# Show outdated
/core:tools:npm "show me outdated packages"

# Run a script
/core:tools:npm "run the build script"

# Publish a package
/core:tools:npm "publish this package with public access"

# Audit
/core:tools:npm "scan for security vulnerabilities"

# Workspace operation
/core:tools:npm "install lodash in the engineer workspace"
```

---

# Registry definition

## Tool metadata

```yaml
name: npm
displayName: npm
provider: npm-inc
category: node-package-manager
optional: false   # required by virtually all Node tools
mutuallyExclusive: [yarn, pnpm]   # one package manager per project
```

## Interfaces

### CLI

```yaml
executable: npm
detectionCommand: npm --version
installCommand: |
  Comes with Node.js:
    macOS:   brew install node
             OR via nvm: brew install nvm; nvm install --lts
    Linux:   distro package manager
             OR via nvm/fnm/asdf
    Windows: winget install OpenJS.NodeJS
             OR via nvm-windows
  
  Recommended: use a Node version manager (nvm, fnm, asdf,
  volta) rather than system Node — easier project-specific
  Node version management.
notes: |
  npm is bundled with Node.js. Latest npm shipped with Node 20+
  recommended.
```

### MCP

**Not available.** No npm MCP server.

## Version constraint

Recommended: npm 10+ (workspaces support, performance).
Most installations have npm matching their Node version.

## Required by skillz commands

Auto-populated. Currently consumed by:
- /engineer:maintenance:upgrades:npm-deps
- Tool installation flows in /core:tools:setup
- Most other Node-tool commands implicitly (Playwright,
  Biome, ESLint, Chromatic, pixelmatch all installed via npm)

## Cross-tool dependencies

- Node.js runtime
- Network access to npm registry (or corporate Nexus mirror)

## Mutually exclusive with

- yarn (different lockfile, different commands)
- pnpm (different lockfile, different commands)

The suite detects which is in use via lockfile presence and
activates the matching tool. Most projects use one consistently.

## System requirements

- Node.js 18+ recommended
- Network: HTTPS to npm registry
- ~/.npm cache (can grow large; cleanup via `npm cache clean`)

## Compliance considerations

Financial institution npm setups typically:
- Use corporate Nexus/Artifactory mirror via .npmrc
- Require auth for the corporate registry
- May have allowlists of approved packages (enforced via
  registry tooling)
- May audit npm install events centrally

The suite reads but doesn't manage .npmrc. Users configure
their corporate registry independently.
