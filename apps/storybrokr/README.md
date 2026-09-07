# @helmsmith/storybrokr

Brokers a throwaway Storybook that contains just one component — and the
components it imports — from a repo's existing `.storybook/` config. A local
daemon owns the running instances, a CLI and an MCP server drive it, and
either surface hands back a URL for every story in seconds instead of the
minutes a full Storybook build takes.

## Why

Booting a whole design system's Storybook to look at one component is slow,
and it gets slower as the design system grows. A 2026-09-06 spike against
skoolscout-com's `app-ui` (Storybook 10.5.0, Node 26) measured the gap:

| Config | Story files | Index entries | Ready |
|---|---|---|---|
| Full app-ui Storybook, run 1 | 356 | 2368 | 38.1s |
| Full app-ui Storybook, run 2 | 356 | 2368 | 38.0s |
| `organisms/calendar/section` + children, run 1 | 16 | 83 | 6.6s |
| `organisms/calendar/section` + children, run 2 | 16 | 83 | 5.5s |

Scoping the config down to one component and its child tree cut both the
work Storybook has to do and the wait before the first screenshot — roughly
6x on this repo, and it only gets better as the design system grows because
the scoped config's size tracks the component, not the whole system. In
storybrokr's own e2e suite, a small react-vite host boots in under two
seconds.

## Install

```bash
npm i -g @helmsmith/storybrokr
```

Requires Node 24 or newer, and a host repo that:

- runs Storybook 7 or newer (older versions fail with `HOST_INVALID`),
- has a `.storybook/main.*`, and
- has its own `node_modules/.bin/storybook` installed.

## Quick start

```bash
storybrokr up components/core/atoms/button
```

The first `up` for a component starts the daemon if one isn't already
running for you, generates a scoped config directory, boots the host's own
`storybook` binary against it on a free port, and waits until it's ready —
printing the instance's id, status, URL, and one line per story once it is.
A second `up` for the same host + component reuses the running instance
instead of booting another one. Add `--json` to get the full instance
record (see `SKILL.md` for its shape) instead of the human-readable summary,
and pipe `stories[].iframeUrl` from that record into a screenshot tool —
it's the story alone, with no Storybook chrome around it.

```bash
storybrokr down <id>       # stop it, or let the idle TTL reap it
```

## How it works

`storybrokr up` resolves the host by walking up from the given path until it
finds a `.storybook/` with a `main.*`, then discovers the component's story
file(s) and every local module they import. It writes a generated config
directory under the host's own
`node_modules/.cache/storybrokr/<instance-id>/`: a `main.ts` that spreads the
host's real `main` config and overrides only `stories` (to the discovered
files) and any absolute paths that need rebasing (`staticDirs`, a Next.js
`nextConfigPath`), plus a `preview`/`manager` file that re-exports the
host's own if one exists. Nothing about the host's addons, webpack/vite
config, or theme changes — the scoped instance runs the same Storybook the
host would.

A local daemon (HTTP on `127.0.0.1`, guarded by a bearer token written to
`~/.storybrokr/daemon.json`) owns every running instance: the CLI and MCP
server are both thin clients that auto-start it on first use. Each instance
also gets a `storybrokr.json` sidecar next to its generated config, so the
daemon can rediscover instances still running from its last restart. An
idle-reaper sweeps on an interval and stops any `ready` instance whose TTL
has elapsed since it was last touched (every `get`/`touch`/reused `up`
resets the clock); a `0` TTL disables reaping.

## Commands

| Command | Purpose |
|---|---|
| `storybrokr up <path> [--host <dir>] [--ttl <min>] [--no-wait] [--json]` | Boot or reuse |
| `storybrokr ls [--json]` / `get <id> [--json]` | Inspect |
| `storybrokr down <id \| --all>` | Stop |
| `storybrokr open <id \| path> [--story <id>]` | Open the manager, or one story, in the browser |
| `storybrokr touch <id>` | Reset the idle timer |
| `storybrokr check <id> [--story <id>]... [--wait-for-text <t> \| --wait-for-selector <s>] [--timeout <ms>] [--json]` | Run stories headlessly; pass/fail per story, exit 1 on any failure |
| `storybrokr screenshot <id> <story-id> [--out <path>] [--viewport <WxH>] [--clip root\|viewport\|page] [--wait-for-text <t> \| --wait-for-selector <s>] [--timeout <ms>] [--json]` | Write a PNG of one story |
| `storybrokr logs <id> [--follow]` | Storybook output |
| `storybrokr doctor [<path>]` | Pre-flight a host |
| `storybrokr daemon start\|stop\|status` | Daemon control |
| `storybrokr mcp` | MCP stdio server |

A few behaviors worth knowing:

- `--ttl` accepts fractional minutes (`--ttl 0.5`); pass `0` to disable
  reaping for that instance.
- `up --no-wait` returns as soon as the instance is registered, with
  `status: "starting"` — poll `get <id>` until it flips to `"ready"`.
- `logs --follow` streams until the instance's log stream ends on its own
  (the instance stopped, or the daemon shut down); Ctrl-C also stops it.
- `daemon status` prints `not running` only when no daemon answers on the
  configured home; any other failure is reported as an error, not silently
  treated as "not running".

## Check and screenshot

Both drive a headless Chromium that the daemon owns. `playwright` is a
regular dependency; the browser itself is fetched on the first
`check`/`screenshot` (`playwright install chromium`, logged by the daemon)
and reused afterwards. `storybrokr doctor` shows whether it is present.

A story **settles** when Storybook's preview reports its render phase
`completed` (play functions run before that), network activity goes quiet,
and, if given, `--wait-for-text` / `--wait-for-selector` matches. Hosts that
show a Suspense fallback first ("Loading translations…") need the wait flag.

- `check` runs every story in the instance (or `--story` ids) one after
  another in a single browser context and prints one line per story. A
  failing or timed-out story is a result row, not an error; the exit code
  is 1 when any story is not `pass`. `played` is true when a play function
  actually ran.
- `screenshot` captures `#storybook-root`'s bounding box by default
  (`--clip viewport` or `page` for the alternatives) at `--viewport`
  (default `1280x720`). A relative `--out` resolves against your cwd; the
  default is `<instance configDir>/screenshots/<story>-<WxH>.png`. It refuses
  to capture a story that failed or timed out (`STORY_FAILED`,
  `STORY_TIMEOUT`).

## MCP

Register storybrokr as an MCP server once it's installed globally:

```bash
claude mcp add storybrokr -- storybrokr mcp
```

Working from this monorepo instead, after building the package:

```bash
pnpm --filter @helmsmith/storybrokr build
claude mcp add storybrokr -- node apps/storybrokr/bin/storybrokr.mjs mcp
```

The MCP server is a thin client of the same daemon the CLI talks to — tools
are `storybrokr_up`, `storybrokr_list`, `storybrokr_get`, `storybrokr_down`,
`storybrokr_logs`, `storybrokr_touch`, `storybrokr_inspect_host`,
`storybrokr_check`, and `storybrokr_screenshot`. `up`'s `ttlMinutes` is an
integer over MCP (the CLI's `--ttl` is the one that takes fractions), and
`wait: false` mirrors `--no-wait`. `storybrokr_screenshot` returns the
written path, not the image; pass an absolute `outPath` to save outside the
host repo. See `SKILL.md` for the full tool schemas and the instance record
shape.

## Configuration

`~/.storybrokr/config.json` (all keys optional; unset ones use the default):

| Key | Default | Meaning |
|---|---|---|
| `ttlMinutes` | 30 | Idle minutes before a ready instance is reaped |
| `instanceCap` | 6 | Max concurrent `starting`/`ready` instances |
| `portRangeStart` | 6100 | First port tried for a new instance |
| `portRangeEnd` | 6199 | Last port tried |
| `readinessTimeoutMs` | 120000 | How long to wait for an instance to report ready before `BOOT_TIMEOUT` |
| `reaperIntervalMs` | 60000 | How often the daemon checks for idle instances |
| `autoStartWaitMs` | 10000 | How long a client waits for an auto-started daemon to come up |
| `browserIdleMinutes` | 10 | Minutes with no open check/screenshot before the daemon closes its Chromium; `0` keeps it open |

`STORYBROKR_HOME` overrides the home directory (`~/.storybrokr` by default) —
the daemon's lock, token, state, and config all move with it; the e2e suite
uses this to run against an isolated home. `STORYBROKR_PORT` pins the port
the detached daemon entry (`dist/server/start.js`, used when a command
auto-starts the daemon) binds to; the foreground `storybrokr daemon start`
takes `--port <n>` instead (default: ephemeral). Either way, `daemon.json`
records whichever port was actually bound.

## Limits

- No file watching: a component added to the tree after `up` isn't picked
  up until the next `up` for that instance regenerates the config.
- Loopback only — there's no remote or multi-host mode.
- Exercised frameworks: `react-vite` runs in CI against a checked-in
  fixture; `@storybook/nextjs` is exercised opt-in (see Contributing) and
  isn't part of the CI gate.
- The per-instance config dir lives under `node_modules/.cache/storybrokr/`,
  which is the Vite config root Storybook's builder uses — so aliases or
  plugins declared only in the host's `vite.config.ts` are not picked up,
  and tsconfig `paths` are not forwarded. Declare them in
  `.storybook/main.ts`'s `viteFinal` for now; forwarding the host Vite
  config is a tracked follow-up.
- The daemon only rediscovers instances still running from a previous
  session for hosts it already has a record of in `~/.storybrokr/state.json`.
  If that file is ever lost, instances left running in other hosts aren't
  rediscovered — they sit there until the next `up` for that same component
  (which regenerates and reclaims the config dir) or a manual
  `node_modules/.cache/storybrokr` cleanup in the host.

## Contributing

```bash
pnpm --filter @helmsmith/storybrokr test       # unit + integration, no Storybook needed
pnpm --filter @helmsmith/storybrokr test:e2e   # builds, then drives the built CLI + MCP
```

`test:e2e` builds the package and runs it against the checked-in
`tests/e2e/fixtures/host-react-vite` fixture, using ports 6100–6199 on an
isolated `STORYBROKR_HOME`. Two more suites are opt-in, off by default:

- `STORYBROKR_E2E_HOST=<path>` (optionally with `STORYBROKR_E2E_COMPONENT=<path>`)
  points the e2e suite at a real external host instead of the fixture —
  useful for exercising a framework other than react-vite, like Next.js.
- `STORYBROKR_E2E_RENDER=1` additionally runs a headless render check; it
  needs a resolvable `playwright` (set `STORYBROKR_PLAYWRIGHT_DIR` if it
  isn't hoisted to somewhere Node can resolve it from).
