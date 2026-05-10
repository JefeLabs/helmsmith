# AgentX Toolbox — Conventions

This document is the source of truth for cross-app conventions in the
`agentx-toolbox` monorepo. New apps and PRs should match this spec; any
deviation needs a written reason in the PR description.

The spec is **enforced by import** wherever possible (shared packages,
root-level overrides) and by review where it isn't.

## Toolchain

| Concern              | Standard                                            |
| -------------------- | --------------------------------------------------- |
| Runtime              | **Bun** (`engines.bun >=1.3`); whole app, not split |
| Package manager      | npm workspaces (Bun is the runtime, not the PM)     |
| Build                | **tsup** → `dist/cli.js` (ESM)                      |
| TypeScript           | extends `tsconfig.base.json` at repo root           |
| CLI argument parsing | **commander** (single major across all apps)        |
| Interactive prompts  | **inquirer** (every prompt also reachable as flag)  |
| TUI                  | **openTUI** (Bun-native; lives in `src/tui/`)       |
| Logger / colors      | `chalk`                                             |
| Tests                | `vitest`                                            |

Versions are pinned via `overrides` in the root `package.json`. Don't
declare these deps with a different range in an app's `package.json` —
the override will win, but the inconsistency is noise.

## Repo relationship

`agentx-toolbox` (this repo) and `agentx-platform` (sibling repo) form
a **package-level DAG with cross-repo references in both directions**.
There is no circular dependency at the package level.

- **Toolbox**: pure TypeScript / Bun. All 6 apps and shared packages.
- **Platform**: mixed. TypeScript (controlplane-ui, etc.) **and** Java
  (the skillzkit catalog backend service is Java).

| Direction                       | Reality                                                                     |
| ------------------------------- | --------------------------------------------------------------------------- |
| Toolbox → Platform (npm)        | Pre-migration: toolbox apps import `@ecruz165/agent-auth`, `@ecruz165/agent-adapter`. Post-migration: those packages move to toolbox; this direction has no live imports. |
| Platform → Toolbox (npm)        | Platform's `controlplane-ui` (TS) imports `@ecruz165/skillzkit-types`. Platform's CLIs (`workspace-cli`, `harness-cli`, `harness-pipeline-cli`, `context-loader-cli`, `edge-context-cli`, `edge-memory-cli`) opt into `@ecruz165/cli-kit` for shared bootstrap. Both are leaf packages — no cycle. |
| Platform → Toolbox (Java side)  | Platform's Java catalog service consumes a **JSON Schema** file (not a TS package). The schema is owned by skillzkit; Java codegens POJOs; TS codegens via `@ecruz165/skillzkit-types` |

No npm package depends on a package that transitively depends on it.
The repos cross-reference, but the package graph stays acyclic.

## Shared toolbox packages (owned here)

These live in `packages/` and follow the platform-aligned naming
convention: **directory name ends in `-lib`, package name drops the
`-lib` suffix.**

For example: directory `agent-auth-lib/` publishes as `@ecruz165/agent-auth`
(not `@ecruz165/agent-auth-lib`). This matches the existing pattern in
`agentx-platform/packages/`.

| Package                       | Directory                       | Use for                                           |
| ----------------------------- | ------------------------------- | ------------------------------------------------- |
| `@ecruz165/agent-auth`      | `packages/agent-auth-lib/`      | Auth (token cache, refresh, whoami, login). Migrating in from platform's `@ecruz165/agent-auth`. |
| `@ecruz165/agent-adapter`   | `packages/agent-adapter-lib/`   | Agent calls (the only package that imports the Anthropic / Copilot / OpenAI SDKs). Migrating in from platform's `@ecruz165/agent-adapter`. |
| `@ecruz165/skillzkit-types` | `packages/skillzkit-types-lib/` | TS types for skillzkit's catalog, skills, commands, workflows. Consumed by skillzkit itself **and** by platform's `controlplane-ui` web frontend. Zero runtime deps (types-only or thin zod). |
| `@ecruz165/cli-kit`             | `packages/cli-kit/`             | Commander bootstrap, inquirer re-export, error wiring, version flag, **pluggable auth wiring**. Consumed by all 6 toolbox apps **and** by platform CLIs (`workspace-cli`, `harness-cli`, `harness-pipeline-cli`, `context-loader-cli`, `edge-context-cli`, `edge-memory-cli`) — 12 total CLIs across both repos. |
| `@ecruz165/tui-view-components` | `packages/tui-view-components-lib/` | Reusable TUI view components (themed primitives, composable widgets, pre-built `<ConnectView>`). Built on openTUI + React. Provides `runConnectView()` for CLI handlers. Consumed by all 6 toolbox apps via their `connect` subcommand. Bun-only at runtime (openTUI uses Bun-specific APIs). |

Rules:

- **Never** import the Anthropic / OpenAI / Copilot SDKs directly. All
  agent calls go through `@ecruz165/agent-adapter`.
- **Never** define skillzkit catalog/skill/command/workflow types
  inline in an app. They live in `@ecruz165/skillzkit-types` and are
  imported.
- **Apps import their CLI scaffold from `@ecruz165/cli-kit`**, not
  re-implement it. If the kit is missing a capability, extend the kit
  — don't fork the bootstrap inside an app.
- **Every app exposes a `connect` subcommand** that calls
  `runConnectView()` from `@ecruz165/tui-view-components`. Apps
  register their auth/connection definitions as `Connection[]` arrays
  passed to the view; users get a uniform "manage your connections"
  TUI experience across the whole toolbox.

### Schema sharing with platform's Java side

The skillzkit catalog has consumers in two languages: skillzkit (TS)
and platform's catalog service (Java). **TypeScript is the source of
truth**; the JSON Schema is a generated artifact.

Pipeline:

```
packages/skillzkit-types-lib/src/index.ts  (canonical, hand-authored TS)
    │ npm run build:schema  →  ts-json-schema-generator
    ▼
apps/skillzkit/schema/catalog.schema.json  (generated, checked in)
    │ jsonschema2pojo  (in agentx-platform CI)
    ▼
Java POJOs
```

- **Source of truth**: `packages/skillzkit-types-lib/src/index.ts`.
  Constraints (regex patterns, formats, min/max, additionalProperties)
  are expressed via JSDoc tags so they propagate to the generated
  schema.
- **Generated artifact**: `apps/skillzkit/schema/catalog.schema.json`.
  Checked into the repo so agentx-platform can read it without
  depending on the TS package. CI runs `npm run verify:schema` to
  ensure it's not out of sync with the TS source.
- **Java side**: agentx-platform consumes the generated schema via
  `jsonschema2pojo` to produce POJOs.

**Don't edit `catalog.schema.json` by hand.** Edit the TS source,
then run `npm run build:schema --workspace=@ecruz165/skillzkit-types`.

### Build order for shared packages

Most shared packages export TS source directly (`"main": "src/index.ts"`):
`@ecruz165/agent-auth`, `@ecruz165/agent-adapter`, `@ecruz165/skillzkit-types`.
Consumers can type-check and bundle these without a separate build step.

**Exception**: `@ecruz165/cli-kit` builds to `dist/` (`"main": "./dist/index.js"`).
Consuming apps cannot resolve cli-kit imports until `npm run build --workspace=@ecruz165/cli-kit`
has run at least once. Run this after any clean clone or `node_modules` wipe.

A future improvement: align cli-kit with the source-export pattern (`"main": "./src/index.ts"`)
to eliminate the build prerequisite. Held back today because cli-kit may be the first
package published externally (where end consumers won't have a TS toolchain).

### Migration plan (auth + agent-adapter, in flight as of 2026-05-09)

**Scope-preserving migration.** Source code moves from
`agentx-platform/packages/agent-auth-lib/` and
`agentx-platform/packages/agent-adapter-lib/` to
`agentx-toolbox/packages/agent-auth-lib/` and
`agentx-toolbox/packages/agent-adapter-lib/`. The published package
names — `@ecruz165/agent-auth` and `@ecruz165/agent-adapter` — stay
exactly the same. Only the source location and the publishing repo
change.

This is the key cost-saver: every consumer's `import` statements are
unchanged. The work is in `package.json` files and CI pipelines, not
in source files.

Audit findings (completed 2026-05-09):

- **Platform internal consumers**: 6 packages internally depend on
  `@ecruz165/agent-auth` and/or `@ecruz165/agent-adapter` — `harness-core`,
  `harness-server`, `harness-cli`, `harness-pipeline-cli`,
  `context-loader-core`, plus `agent-adapter-lib` itself (which imports
  `agent-auth`). ~30 source files use these libs. The harness ecosystem
  is the *primary* consumer; toolbox apps are the minority.
- **Toolbox consumers**: 3 apps — `pritty`, `taskmaster`, `skillzkit`.
- **Platform → Toolbox imports**: none today. The `skillzkit-types`
  and `cli-kit` imports are future work (after those packages are
  authored).

Open audit items before code-moves:

- [x] **Auth web-UI concerns**: resolved 2026-05-10. `agent-auth-lib`
  has zero web-UI dependencies (no express/fastify/hono/react/window/
  document/cookie/localStorage). The "session" hits in grep were all
  about Copilot session-token exchange — false positives. Migrated as-is.
- [x] **Agent-adapter platform-specific deps**: resolved 2026-05-10.
  Only deps are `@ecruz165/agent-auth` (workspace), `@anthropic-ai/sdk`,
  `@langchain/core`, `@langchain/langgraph`, `zod`. No platform-only
  services. Migrated as-is.

Migration sequence:

1. Resolve the two open audit items above.
2. Move source from platform into toolbox (preserve git history with
   `git filter-repo` or `git format-patch | git am` — never naive copy).
3. Wire up toolbox build/publish pipeline for `@ecruz165/agent-auth`
   and `@ecruz165/agent-adapter`.
4. Publish `@ecruz165/agent-auth@<v>` and `@ecruz165/agent-adapter@<v>`
   from toolbox.
5. Update agentx-platform's 6 internal-consumer `package.json` files:
   change `"@ecruz165/agent-auth": "workspace:*"` to
   `"@ecruz165/agent-auth": "^<v>"` (and same for agent-adapter).
   Source imports require **no changes** — names match.
6. Remove `packages/agent-auth-lib/` and `packages/agent-adapter-lib/`
   from agentx-platform's `pnpm-workspace.yaml` and delete the now-
   empty directories from platform. Stop platform's release pipeline
   from publishing those package names.
7. Delete the empty npm-link shell at toolbox's `packages/agent-adapter/`
   (it's superseded by the real `packages/agent-adapter-lib/`).
8. Update toolbox apps (pritty, taskmaster, skillzkit) to depend on
   the workspace-resolved versions: change `"@ecruz165/agent-auth": "*"`
   to `"@ecruz165/agent-auth": "workspace:*"` in their `package.json`.

## Per-app directory layout

```
apps/<name>/
├── bin/
│   └── <name>.mjs        # stub: #!/usr/bin/env bun → import('../dist/cli.js')
├── src/
│   ├── cli.ts            # commander setup, registers commands; imports @ecruz165/cli-kit
│   ├── commands/         # one file per subcommand; exports an action handler
│   │   ├── foo.ts
│   │   └── foo.test.ts   # co-located unit test
│   ├── lib/              # app-internal helpers (not commands, not TUI)
│   ├── tui/              # openTUI views (only if the app has a TUI surface)
│   └── server/           # only if the app exposes an HTTP/REST surface
├── tests/
│   └── e2e/              # end-to-end tests that spawn the CLI as a subprocess
├── dist/                 # gitignored, tsup output
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

**Why two test locations?**
- **Co-located `*.test.ts`** for unit tests next to source — fast to
  navigate, the test moves with the file when refactored.
- **`tests/e2e/`** for end-to-end tests that spawn the built CLI — these
  are slower, share fixtures, and benefit from grouping.

Integration tests (between layers but no subprocess) go co-located with
the layer they're testing. If you have a test that needs the CLI to be
*built* before running, it's e2e — put it in `tests/e2e/`.

## Required `package.json` shape

```json
{
  "name": "@ecruz165/<name>",
  "version": "0.x.y",
  "type": "module",
  "engines": { "bun": ">=1.3" },
  "bin": { "<name>": "./bin/<name>.mjs" },
  "main": "./dist/cli.js",
  "exports": { ".": "./dist/cli.js" },
  "scripts": {
    "build": "tsup",
    "dev": "bun run src/cli.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run tests/e2e",
    "typecheck": "tsc --noEmit"
  }
}
```

Every app must implement every script above (even if some are thin
wrappers). `npm test` at the root runs them all via workspaces — a
missing script means that app silently doesn't get tested.

## Bin stub pattern

`apps/<name>/bin/<name>.mjs`:

```js
#!/usr/bin/env bun
import('../dist/cli.js');
```

Source lives in `src/cli.ts`. The stub exists so `npm run build` (tsup)
can rewrite the import target without touching what npm publishes as
the bin entry. **Don't** put TS source in `bin/` — npm consumers don't
get tsx/Bun for free, and the stub keeps the bin tiny and transparent.

For apps without a separate `bin/` stub (gitradar today), tsup injects
the shebang via the `banner.js` config option. Either pattern is fine;
pick the stub pattern for new apps so the bin entry stays inspectable
without a build step.

## Bun distribution

**Bundle the Bun binary as a per-app dependency.** Every app's
`package.json` declares `"bun": "^1.3.13"` in `dependencies`. The
`bun` npm package's `postinstall` script downloads the platform-specific
Bun binary into the app's `node_modules/.bin/`. Combined with the
`#!/usr/bin/env bun` shebang, this means `npm install -g @ecruz165/<app>`
brings everything an end user needs in one step — no separate
`curl https://bun.sh/install | bash` prerequisite.

Trade-off: ~50–80 MB of Bun binary per app's `node_modules`. For a
toolbox shipped to internal dev teams, the install-experience win
beats the disk-space cost. If that calculus changes (e.g., for an
externally-published CLI where install size matters), the alternatives
are:

- **engines-only** (`engines.bun >=1.3` only; users install Bun
  separately) — leanest, but two-step install.
- **`bun build --compile`** (per-platform single executable bundling
  Bun + app code) — best end-user UX outside the npm ecosystem
  (homebrew, GitHub releases). Each release ships per-platform
  binaries (~60 MB each).

The current "bundle as dep" choice is documented in CONVENTIONS so
new apps follow it. Don't deviate without writing down why in the
PR description.

## TypeScript configuration

Each app's `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "types": ["bun"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "**/*.test.ts", "tests/**"]
}
```

- `rootDir` and `outDir` are always relative `./src` and `./dist`.
- Don't override `module` / `moduleResolution` / `target` — the base
  handles them. If you think you need to, raise it as a base-config
  change instead.
- `types: ["bun"]` opts into `@types/bun` so `Bun.spawn` etc. type-check.
- `noEmit` and `outDir` together is a contradiction — never set both.

## Test conventions

- **File suffix**: `*.test.ts` (never `*.spec.ts`).
- **Unit tests**: co-located with the source they test.
- **E2E tests**: `tests/e2e/`, run via `vitest run tests/e2e`.
- **vitest config is required** in every app, even if minimal — at
  least `exclude: ['dist/**']`. App-specific needs (e.g. gitradar's
  `pool: "forks", fileParallelism: false` for SQLite safety) go here.
- **Test names** describe behavior, not implementation:
  `it('rejects empty commit messages')`, not `it('returns false')`.

## CLI command structure

Every subcommand is its own file in `src/commands/<verb>.ts`, exporting
an action handler:

```ts
// src/commands/commit.ts
import type { Command } from 'commander';

export interface CommitOptions {
  message?: string;
  yes?: boolean;
}

export async function commitAction(opts: CommitOptions) {
  // ...handler logic
}

export function registerCommit(program: Command) {
  program
    .command('commit')
    .option('-m, --message <msg>', 'commit message')
    .option('-y, --yes', 'skip confirmation')
    .action(commitAction);
}
```

`src/cli.ts` only does program setup and registration:

```ts
import { createCli } from '@ecruz165/cli-kit';
import { registerCommit } from './commands/commit.js';

const program = createCli({ name: 'pritty', version: VERSION });
registerCommit(program);
program.parse();
```

This shape is enforced by the recent refactors (commits 40864b6,
cedde02). Action handlers stay testable in isolation; commander wiring
stays in one place per app.

## Interactive prompts

Use `inquirer` (re-exported from `@ecruz165/cli-kit`). **Every interactive
prompt must have a non-interactive equivalent flag** — otherwise CI
breaks. Pattern:

```ts
const message = opts.message ?? await inquirer.prompt([
  { type: 'input', name: 'message', message: 'Commit message:' }
]).then(a => a.message);
```

Never prompt without checking the flag first.

## TUI

openTUI views live in `src/tui/`. The TUI is invoked by a command (e.g.
`gitradar dashboard`) that imports from `src/tui/` and runs the openTUI
app. Don't mix TUI rendering with action handlers — the action handler
launches the TUI; the TUI module owns the screen.

## Adding a new app

1. Copy an existing app (recommend `pritty` once retrofitted — closest to spec).
2. Update `name`, `bin`, and `description` in `package.json`.
3. Replace `src/commands/` and `src/cli.ts` with your commands.
4. Add a README that mirrors the existing apps' shape (Install / Quick
   Start / Commands / Contributing).
5. Run `npm install` at the root.
6. Run `npm run build && npm test` to verify the scaffold works.

## Migration status (as of 2026-05-09)

### Cross-cutting

- [x] **Audit cross-repo imports.** Confirmed: 6 platform packages
      internally use `@ecruz165/agent-auth` / `@ecruz165/agent-adapter`
      (harness-core, harness-server, harness-cli, harness-pipeline-cli,
      context-loader-core, plus self-references inside agent-adapter-lib).
      ~30 source files. Toolbox: 3 apps (pritty, taskmaster, skillzkit)
      consume the same two packages.
- [x] **Correct toolbox publishing scope: `@agentx/*` → `@ecruz165/*`.**
      Completed 2026-05-09. All 5 app `package.json` `name` fields
      renamed. Functional code updated (`apps/toolz/src/cli.ts`
      version-detection comparison; `apps/toolz/src/core/built-in-catalog.ts`
      install identifiers for apt/brew/winget; pritty + toolz public-API
      JSDoc; pritty's command-template strings). 14 doc files updated
      via sed. Root `package.json` workspace script refs updated. The
      `@agentx/*` references that remain in `CONVENTIONS.md` are
      intentional — they describe the rename's from-state.
- [x] **Migrate `@ecruz165/agent-auth` source from platform into
      toolbox** at `packages/agent-auth-lib/`. Completed 2026-05-10.
      Source copied via rsync (excluding node_modules, dist).
      `tsconfig.json` standalone (Bundler resolution + TS-extension
      imports) since it diverges from toolbox base. Workspace symlink
      verified at `node_modules/@ecruz165/agent-auth → packages/agent-auth-lib`.
      Type-check clean.
- [x] **Migrate `@ecruz165/agent-adapter` source from platform into
      toolbox** at `packages/agent-adapter-lib/`. Completed 2026-05-10.
      Same migration mechanics. Replaced empty `packages/agent-adapter/`
      shell. Updated `"@ecruz165/agent-auth": "workspace:*"` →
      `"*"` (npm-workspaces convention; pnpm's workspace protocol isn't
      portable). Type-check clean. Brings @anthropic-ai/sdk, @langchain/core,
      @langchain/langgraph, zod into toolbox's transitive dep graph.
- [x] **Create `@ecruz165/skillzkit-types`** at `packages/skillzkit-types-lib/`.
      Completed 2026-05-10. Hand-authored TS types in `src/index.ts`
      with JSDoc tags (`@pattern`, `@format`, `@minimum`,
      `@additionalProperties`) for JSON Schema constraints. Zero
      runtime deps (types-only). 6/6 smoke tests pass.
- [x] **Generate `apps/skillzkit/schema/catalog.schema.json`** from
      the TS source. Completed 2026-05-10. **TS-first pipeline locked:**
      `src/index.ts` (canonical) → `ts-json-schema-generator` → JSON
      Schema (generated, checked in) → `jsonschema2pojo` (in
      agentx-platform CI) → Java POJOs.
      `npm run build:schema --workspace=@ecruz165/skillzkit-types`
      regenerates; `npm run verify:schema` is the CI gate that fails
      the PR if the file is out of sync.
- [x] **Create `@ecruz165/cli-kit`** at `packages/cli-kit-lib/`.
      Scaffolded 2026-05-09. Runtime-agnostic (no Bun-specific
      imports). commander + inquirer as peer deps. `AuthProvider`
      interface is minimal (`getToken`, optional `whoami`) — login
      flows stay in the auth library. `createCli({ name, version,
      auth })` returns `{ program, auth }`. Includes vitest smoke
      tests. **Open**: per-app adoption (each app's `src/cli.ts`
      switches to `import { createCli } from '@ecruz165/cli-kit'`)
      and platform-side adoption (opt-in for the 6 platform CLIs).
- [ ] **Pin shared dep versions** via `overrides` in root `package.json`
      (commander, vitest, typescript, tsup, inquirer, @types/bun).
- [ ] **Update agentx-platform `package.json` files**:
      - 6 packages drop `workspace:*` reference to `@ecruz165/agent-auth`
        / `@ecruz165/agent-adapter`; replace with external semver range
        pointing at the toolbox-published versions.
      - Remove the now-emptied `packages/agent-auth-lib/` and
        `packages/agent-adapter-lib/` directories from platform's
        pnpm-workspace.
      - Add `@ecruz165/skillzkit-types` dep to `controlplane-ui` when
        the frontend starts rendering catalog data (separate workstream).

### Per-app

| App        | scope rename | src/ layout | commander | tsup    | bun shebang | inquirer | openTUI | cli-kit | e2e dir |
| ---------- | ------------ | ----------- | --------- | ------- | ----------- | -------- | ------- | ------- | ------- |
| skillzkit  | ✅           | ✅          | ✅ v14    | ✅      | ✅          | ❌       | ❌      | ✅      | ✅      |
| toolz      | ✅           | ✅          | ✅ v14    | ✅      | ✅          | ❌       | n/a     | ✅      | ✅      |
| gitradar   | ✅           | ✅          | ✅ v14    | ✅      | ✅          | ✅ v8    | ❌      | ✅      | ✅      |
| pritty     | ✅           | ✅          | ✅ v14    | ✅      | ✅          | ✅ v8    | n/a     | ✅      | ✅      |
| taskmaster | ✅           | ✅          | ✅ v14    | ✅      | ✅          | ✅ v8    | n/a     | ✅      | ✅      |
| gittyup    | ✅           | ✅          | ✅ v14    | ✅      | ✅          | ✅ v8    | n/a     | ✅      | ✅      |

Update both tables as items land.
