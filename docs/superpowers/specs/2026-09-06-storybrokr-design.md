# storybrokr — Design

**Date:** 2026-09-06
**Scope:** new app `apps/storybrokr` (`@helmsmith/storybrokr`)
**Status:** approved section by section in conversation; this document is the written record.

## 1. Problem

Storybook is the right tool for looking at one component, but booting one means booting all of
them. skoolscout-com's `app-ui` runs `@storybook/nextjs` on webpack over 356 story files, and a
full boot takes about 38 seconds to ready. That cost is paid on every design check-in, and it
compounds when several coding agents work on different components in the same checkout: they
collide on port 6006, share one cache, and at least one gives up on the visual step. In August
2026 an agent built its own esbuild-plus-Playwright harness to screenshot a component because
the full Storybook would not boot headless for it.

Narrowing the `stories` glob by hand solves one human at one terminal. It does not allocate
ports, reap idle instances, outlive an agent session, or tell an agent which URL shows which
story.

## 2. What storybrokr is

A local daemon, a CLI, and an MCP server that **broker ephemeral Storybook instances scoped to
one component and its child components, derived from a host repo's existing Storybook.**

It never scaffolds a Storybook. It takes a repo that already has `.storybook/`, generates a
throwaway config directory that inherits the host's `main` and `preview` and overrides only the
story list, boots the host's own `storybook` binary against it on a free port, and hands back a
URL plus a machine-readable list of every story in the instance.

### 2.1 Spike evidence (2026-09-06, skoolscout-com/app-ui, Storybook 10.5.0, Node 26)

| Config | Story files | Index entries | Ready |
|---|---|---|---|
| Full app-ui Storybook, run 1 | 356 | 2368 | 38.1s |
| Full app-ui Storybook, run 2 | 356 | 2368 | 38.0s |
| `organisms/calendar/section` + children, run 1 | 16 | 83 | 6.6s |
| `organisms/calendar/section` + children, run 2 | 16 | 83 | 5.5s |

"Ready" is webpack at 100%, `/index.json` served, and the "Local:" banner printed. Both configs
emitted the same two pre-existing host warnings and zero errors. The CalendarSection Default
story rendered headlessly with the host's providers, theme tokens, and CSS intact. Child
discovery walked 42 modules and resolved every relative and `@core/*` alias import.

## 3. Decisions (made with the user)

| Decision | Choice |
|---|---|
| Placement | `helmsmith/apps/storybrokr`, published as `@helmsmith/storybrokr`, bin and MCP server named `storybrokr` |
| Shape | Long-lived local daemon that spawns ephemeral per-component instances |
| Surfaces | CLI, HTTP API (daemon), MCP stdio server, `SKILL.md` shipped in the package |
| Instance scope | The target component's stories plus the stories of its child components |
| Component addressing | Story-file path (folder or `*.stories.*`), relative to the host root. No name index |
| Child discovery | Import graph, transitive, story-bearing modules only. Relative imports and tsconfig `paths` aliases; `node_modules` never entered |
| Architecture | Daemon owns registry, ports, spawning, readiness, reaping; CLI and MCP are thin HTTP clients |
| Config dir location | `<host>/node_modules/.cache/storybrokr/<id>/` |

Rejected: a state file with detached processes and no daemon (no reaping, no readiness
streaming, lock races between agents); a daemon embedded in the MCP server (instances die with
the agent session; two sessions fight over ports); story-title addressing via the host's story
index (needs a built or running host); folder-nesting-only discovery (misses the common
cross-folder case, e.g. an organism importing `../CalendarEventCard`).

The name was checked 2026-09-06: `storybrokr` is free on npm, absent from `$PATH`, and no
GitHub repository uses it. Claiming an npm name is irreversible, so the first publish goes
through the Makefile `PUBLISH_PKGS` allowlist, not the weekly workflow.

## 4. Process model

Four kinds of process:

- **Daemon.** `storybrokr daemon start|stop|status`; every other command auto-starts it when
  it is not running. A Bun HTTP server bound to `127.0.0.1` on a port recorded in
  `~/.storybrokr/daemon.json`, protected by a random bearer token written to that file with
  owner-only permissions. Owns the registry, port allocation, spawning, readiness, idle
  reaping, and log capture.
- **Instances.** Child processes of the daemon: the host's own `node_modules/.bin/storybook dev`
  with `--config-dir` pointing at a generated directory, plus `--exact-port --ci --no-open
  --disable-telemetry`, working directory set to the host root so Next.js and Vite find their
  configs.
- **CLI.** Short-lived thin client. Every subcommand is one HTTP call, printed as a table or
  as JSON with `--json`.
- **MCP server.** `storybrokr mcp`, stdio transport, also a thin client. Instances outlive the
  agent session because the daemon owns them.

### 4.1 Registry

An in-memory map persisted to `~/.storybrokr/state.json`. Each record: `id`, `hostRoot`,
`component` (path relative to host root, the dedupe key together with `hostRoot`), resolved
`storyFiles`, `port`, `pid`, `url`, `status`, `createdAt`, `lastTouchedAt`, `ttlMinutes`.
Requesting the same host and component twice returns the existing instance.

Each config dir also holds a `storybrokr.json` sidecar with the same record. The config dirs
on disk, not `state.json`, are the source of truth: the state file is a cache the daemon can
lose without consequence, and `ls node_modules/.cache/storybrokr/` in any host is an honest
inventory even when the daemon is down.

### 4.2 Home directory and defaults

The home directory is `~/.storybrokr`, overridable with the `STORYBROKR_HOME` environment
variable. It holds `daemon.json`, `daemon.lock`, `state.json`, and `config.json`. Every
setting below is a key in `config.json`.

| Setting | Default |
|---|---|
| Idle TTL | 30 minutes |
| Instance cap | 6 |
| Port range | 6100–6199 |
| Readiness timeout | 120 seconds |
| Reaper interval | 60 seconds |
| Daemon auto-start wait | 10 seconds |

## 5. Surfaces

All three surfaces map one to one onto the same daemon operations and return the same
instance shape.

### 5.1 Instance shape

```
{ id, hostRoot, component, framework, port, url, pid,
  status: "starting" | "ready" | "failed" | "stopped",
  createdAt, lastTouchedAt, ttlMinutes,
  stories: [{ id, title, name, importPath, url, iframeUrl }],
  error?: { code, message, logTail } }
```

`stories` is filled once the instance is ready, from its own `/index.json`. `url` is the
manager URL `/?path=/story/<id>`; `iframeUrl` is `/iframe.html?id=<id>&viewMode=story`, the
form an agent hands to Playwright or Chrome DevTools to screenshot one story without the
Storybook chrome.

### 5.2 CLI

- `storybrokr up <path> [--host <dir>] [--ttl <min>] [--no-wait] [--json]`
- `storybrokr ls [--json]`
- `storybrokr get <id | path> [--json]`
- `storybrokr down <id | path | --all>`
- `storybrokr open <id | path> [--story <id>]`
- `storybrokr logs <id> [--follow] [--tail N]`
- `storybrokr touch <id>`
- `storybrokr doctor [<path>]` — pre-flight for a host: `.storybook/` present, `storybook`
  binary and version, framework detected, tsconfig `paths` parsed. Same code path the daemon
  runs, so failures are explained before anything spawns.
- `storybrokr daemon start | stop | status`
- `storybrokr mcp`

Every interactive prompt has a flag equivalent; `--json` output is stable and documented in
`SKILL.md`.

**Convention deviation, recorded here per `docs/toolbox-conventions.md`:** the toolbox rule
that every app exposes a `connect` subcommand for managing auth connections does not apply.
storybrokr has no external connections and ships no `connect` command.

### 5.3 HTTP API (daemon, loopback only, bearer token, prefix `/v1`)

| Method and path | Purpose |
|---|---|
| `POST /instances` `{ component, hostRoot?, ttlMinutes?, wait? }` | Create; 201 new, 200 existing match |
| `GET /instances` | List |
| `GET /instances/:id` | Detail (touches) |
| `DELETE /instances/:id` | Stop and remove |
| `POST /instances/:id/touch` | Reset idle timer |
| `GET /instances/:id/logs?tail=200` | Log tail; `?follow=1` upgrades to server-sent events |
| `POST /hosts/inspect` `{ path }` | Backs `doctor` |
| `GET /health` | Daemon version, uptime, counts |
| `POST /shutdown` | Stop all instances, exit |

### 5.4 MCP tools

`storybrokr_up`, `storybrokr_list`, `storybrokr_get`, `storybrokr_down`, `storybrokr_logs`,
`storybrokr_touch`, `storybrokr_inspect_host`. Inputs mirror the HTTP bodies; outputs are the
instance shape; failures return the error object with `isError` set. The prefix keeps them
distinct from Storybook's own MCP tools if a host runs both.

### 5.5 SKILL.md

Ships in the package `files` (as `pritty` does). It teaches an agent three things: when to
reach for storybrokr (a design check-in or visual verification of one component); the loop of
`up`, screenshot by `iframeUrl`, `down`; and the JSON shapes above. It states explicitly that a
story's DOM may show a Suspense fallback first (app-ui shows "Loading translations..."), so a
screenshot needs a content wait, not just a DOM-child wait.

## 6. The `up` data flow

1. **Resolve the host.** Walk up from the given path until a directory containing
   `.storybook/` is found; that is the host root. Read `.storybook/main.{ts,js,mjs}` for the
   framework and whether `preview.*` and `manager.*` exist. Read `tsconfig.json` `paths`.
   Verify `node_modules/.bin/storybook` exists and record its version. Any failure is
   `HOST_NOT_FOUND` or `HOST_INVALID` naming the missing piece; `doctor` runs this same step.
2. **Normalize the component.** A folder contributes its own story files plus every non-story,
   non-test, non-types source file as import-graph entry points. A file contributes only
   itself. The component key is the path relative to the host root.
3. **Discover children.** Breadth-first over local imports, static and dynamic. Relative
   specifiers resolve against the importing file; bare specifiers are matched against
   `tsconfig` `paths` in declaration order, trying each target in turn. Extensionless and
   `index` resolution try `.tsx`, `.ts`, `.jsx`, `.js`. `node_modules` is never entered.
   Every visited module contributes any sibling `*.stories.*` whose basename starts with the
   module's basename; a module named `index` contributes every story file in its directory.
   Output is a sorted, deduplicated file list. Unresolvable specifiers are
   logged, never fatal. A component with zero reachable story files is `COMPONENT_NOT_FOUND`.
4. **Allocate.** Under the registry lock: an existing `ready` or `starting` match is touched
   and returned. Otherwise enforce the cap, pick the first free port in range by attempting a
   bind, and mint an id from a short hash of host root plus component key.
5. **Generate the config dir** at `<host>/node_modules/.cache/storybrokr/<id>/`:
   - `main.ts` imports the host main, spreads it, replaces `stories` with the explicit file
     list as paths relative to the config dir, absolutizes `staticDirs` (string and
     `{ from, to }` forms), and absolutizes `framework.options.nextConfigPath` when present.
     It handles both the string and object forms of `framework`. It imports from `node:path`;
     it must not use `require`, because Storybook loads it as ESM.
   - `preview.<ext>` does `export *` plus `export { default }` from the host preview, using
     the host's extension.
   - `manager.<ext>` gets the same treatment only if the host has one.
   - `storybrokr.json` sidecar with the instance record.
6. **Spawn** the host's `storybook` binary with `dev --config-dir <dir> --port <port>
   --exact-port --ci --no-open --disable-telemetry`, working directory the host root,
   `CI=1` and `FORCE_COLOR=0` in the environment. Stdout and stderr go to a ring buffer of
   the last 2000 lines and to `<dir>/storybook.log`. Status becomes `starting`.
7. **Readiness** requires all three: `GET /index.json` returns 200, the "Local:" banner line
   has appeared, and no failure-pattern line has appeared. The spike showed the banner and
   webpack's 100% line within 0.2s of each other. On success the daemon parses `index.json`
   into `stories` and flips status to `ready`. Timeout or process exit before readiness flips
   status to `failed` with the log tail.
8. **Return.** With `wait` true (default) the caller receives the ready instance; with `wait`
   false it receives the `starting` record and polls `GET /instances/:id`.

Why basename matching rather than parsing each story file's `component` field: the spike's
`CalendarHeader` folder holds `CalendarHeader.stories.tsx` and `CalendarHeaderWithTabs.stories.tsx`,
and the basename rule picked up both. Parsing CSF would mean executing or AST-walking every
story file for a small payoff; a false positive only adds a story the caller can ignore.

Why the config dir lives under the host's `node_modules/.cache`: Node's upward resolution
finds the host's framework and addons without path tricks; the host repo stays untouched;
and Storybook keys its manager cache by a hash of the config directory path
(`node_modules/.cache/storybook/<version>/<hash>/`), so parallel instances of the same host
do not trample each other. Webpack's optional `fsCache` and Vite's `cacheDir` are keyed the
same way; nothing extra is done.

## 7. Lifecycle and error handling

### 7.1 Instance lifetime

- **Idle reaping.** `lastTouchedAt` is refreshed by `up` returning an existing match, `touch`,
  `get`, and log reads. A reaper tick runs every 60 seconds and stops any `ready` instance
  idle longer than its TTL. `--ttl 0` opts an instance out of reaping for the daemon's
  lifetime.
- **Stopping.** SIGTERM, wait 5 seconds, then SIGKILL. The config dir is deleted; the record
  becomes `stopped` for one reaper tick so a caller can read the final state, then it is
  dropped.
- **Crash detection.** The daemon owns the child, so exit is immediate. Exit before readiness
  is `failed` with the log tail. Exit after readiness marks the record `failed` with
  `exitCode` and keeps it until the next `up` for that component or `down` clears it, so an
  agent returning to a dead URL gets a reason rather than a connection refused.

### 7.2 Daemon lifetime

- **Auto-start.** A client that cannot reach the daemon spawns `storybrokr daemon start`
  detached, waits up to 10 seconds for `/health`, then retries the original request once.
  Startup takes an exclusive lock on `~/.storybrokr/daemon.lock`, so a second daemon is never
  started.
- **Reconciliation on start.** Read `state.json`; for each record check the PID is alive and
  `GET /index.json` on that port answers. Alive and answering is adopted as `ready`; anything
  else is dropped and its config dir removed. Config dirs on disk with a sidecar but no state
  record get the same check, which is what makes a stale or missing `state.json` harmless.
- **Shutdown.** `daemon stop` and SIGTERM both stop every instance first, then exit. The
  token is regenerated on every start; a client holding an old token gets 401 and re-reads
  `daemon.json`.

### 7.3 Error contract

Every failure carries a stable `code`, a human `message`, and where relevant `logTail`. The
CLI prints the message and exits nonzero (`--json` prints the object); HTTP maps codes to
status; MCP returns the object with `isError`.

| Code | When | HTTP |
|---|---|---|
| `HOST_NOT_FOUND` | No `.storybook/` above the path | 404 |
| `HOST_INVALID` | Storybook binary missing, main unreadable, unsupported version | 422 |
| `COMPONENT_NOT_FOUND` | Path missing, or no story files reachable from it | 404 |
| `INSTANCE_CAP_REACHED` | Cap hit and nothing idle to reap | 429 |
| `NO_FREE_PORT` | Range exhausted | 503 |
| `BOOT_FAILED` | Exit or failure pattern before ready; log tail attached | 502 |
| `BOOT_TIMEOUT` | Readiness deadline passed; log tail attached | 504 |
| `INSTANCE_NOT_FOUND` | Unknown id or path on `down`, `get`, `logs` | 404 |
| `DAEMON_UNAVAILABLE` | Auto-start failed | client-side only |

### 7.4 Deliberately not handled

- **File watching.** Storybook's HMR covers edits to the component and its children. A
  brand-new child with its own stories needs a fresh `up`, which is idempotent and reuses the
  instance.
- **Multi-user machines.** Loopback plus an owner-only token file is the whole security
  model. It is not a shared service.
- **Host cache corruption.** Covered by Storybook's own config-dir-keyed caching; see §6.

## 8. Package layout and conventions

Follows `docs/toolbox-conventions.md`.

```
apps/storybrokr/
  bin/storybrokr.mjs           #!/usr/bin/env bun → import('../dist/cli.js')
  src/cli.ts                   createCli from @helmsmith/cli-kit; registers commands only
  src/commands/                up, ls, get, down, open, logs, touch, doctor, daemon, mcp
  src/server/                  daemon.ts, routes.ts, registry.ts, state.ts, reaper.ts
  src/lib/                     host.ts, discover.ts, instance.ts, ports.ts, readiness.ts, errors.ts
  src/mcp/server.ts            MCP stdio server; tools map 1:1 to routes
  tests/e2e/                   subprocess tests against the fixture host
  tests/e2e/fixtures/host-react-vite/   private workspace package (see §9)
  SKILL.md  README.md  tsup.config.ts  vitest.config.ts  tsconfig.json  package.json
```

`package.json`: `@helmsmith/storybrokr`, `type: module`, `publishConfig.access: public`,
`engines.bun >= 1.3`, `bun` as a runtime dependency, `bin.storybrokr`, `files` = `dist`, `bin`,
`README.md`, `SKILL.md`. Scripts: `build`, `dev`, `test`, `test:watch`, `test:e2e`,
`typecheck`, `prepack`.

**Bundling decision.** `tsup.config.ts` sets `noExternal: [/^@helmsmith\//]` so
`@helmsmith/cli-kit` is bundled into `dist/`. Reason: cli-kit has never been published, and
a tarball that declares it as a dependency is uninstallable from npm. gitradar's config does
not do this today; that is gitradar's problem to fix, not a pattern to copy.

Dependencies beyond cli-kit: `commander` and `@inquirer/prompts` (cli-kit declares them as
peer dependencies, so the app declares them directly), `zod` for schemas shared by routes
and MCP tools, `@modelcontextprotocol/sdk` for the stdio server, `chalk`. No Playwright, no
Storybook.

## 9. Testing

### 9.1 Unit, co-located `*.test.ts`

- `discover`: relative and alias resolution in `paths` declaration order, extensionless and
  index resolution, dynamic imports, import cycles, the story-basename rule, unresolved
  specifiers logged and not thrown. Fixtures are small synthetic trees written to a temp dir.
- `instance` (config generation): snapshot the emitted `main.ts` and `preview.*` for a fake
  host main in both `framework` forms; assert `staticDirs` and `nextConfigPath` come out
  absolute and `stories` relative to the config dir.
- `registry`: dedupe by host plus component, cap enforcement, TTL reaping with a fake clock,
  reconciliation with a fake PID probe.
- `readiness`: fake HTTP server plus scripted log stream covering banner before index, index
  before banner, a failure pattern, and timeout.
- `host`, `ports`, `errors`, MCP tool schemas: one file each.

### 9.2 Integration, in-process

The daemon's routes run against an in-memory registry and a fake spawner. This is the HTTP
contract: 201 versus 200 on `up`, 401 without the token, and every row of §7.3 asserted by
code and status.

### 9.3 E2E, `tests/e2e/`, spawning the built CLI

Host fixture `tests/e2e/fixtures/host-react-vite/`: a private workspace package
(`@helmsmith/storybrokr-fixture-react-vite`, `private: true`) with three components, one
composing the other two, each with stories, plus a `paths` alias. Making it a workspace
package is the one change outside `apps/storybrokr/`: a `pnpm-workspace.yaml` glob
`apps/storybrokr/tests/e2e/fixtures/*`, so pnpm installs its Storybook and creates its own
`node_modules/.bin/storybook`. The weekly-publish detector already refuses private packages.

Scenarios: `up` returns `ready` with exactly the expected story set; a second `up` returns
the same id; `ls` and `logs` show it; `down` removes the config dir; a first CLI call
auto-starts the daemon; killing the daemon and calling `ls` adopts the still-running
instance; a short `--ttl` with the reaper interval lowered in the test home's `config.json`
reaps it; an MCP client spawns `storybrokr mcp` and calls `storybrokr_up` end to end. Each
`up` prints its ready time so CI logs carry the number; nothing asserts on timing. Tests set
`STORYBROKR_HOME` to a temp dir so they never touch `~/.storybrokr`.

### 9.4 Opt-in tests, skipped unless the env var is set

- `STORYBROKR_E2E_HOST=<path>` runs the `up` scenario against a real external host. This is
  how the `@storybook/nextjs` webpack path stays covered: run it against skoolscout-com's
  app-ui locally. CI carries no Next.js fixture.
- `STORYBROKR_E2E_RENDER=1` runs the headless render check from the spike using whatever
  Playwright is resolvable. Playwright is not added to helmsmith.

### 9.5 Wiring

`test` runs `vitest run` over unit and integration (vitest config excludes `tests/e2e`).
`test:e2e` runs `tsup && vitest run tests/e2e`. CI's `pnpm -r --if-present test` covers the
first; `.github/workflows/ci.yml` gains one step, `pnpm --filter @helmsmith/storybrokr
test:e2e`, after the vitest step. The spike scripts are seeds, not kept: `discover.mjs`
becomes `src/lib/discover.ts` and its tests; `boot-timer.mjs` becomes `readiness.ts` plus the
e2e timing output; `render-check.mjs` becomes the opt-in render test.

## 10. Release

First publish through `make publish` with `@helmsmith/storybrokr` added to `PUBLISH_PKGS`,
after `make publish-dry` shows the tarball contains `dist`, `bin`, `README.md`, `SKILL.md` and
nothing else. Subsequent releases ride the weekly workflow. `README.md` mirrors the other
apps (Install, Quick Start, Commands, Contributing) and leads with the spike numbers.

## 11. Out of scope for this round

- Name-based component lookup or a story index.
- Screenshots or visual diffing; the tool returns URLs, agents bring their own browser.
- Composition (`refs`) across instances.
- A TUI.
- Frameworks other than what the host already runs; the recipe is framework-agnostic and
  only react-vite (fixture) and nextjs (opt-in, app-ui) are exercised.
