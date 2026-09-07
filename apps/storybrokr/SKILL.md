---
name: storybrokr
description: Broker an ephemeral Storybook for ONE component (plus its child components) from a repo's existing .storybook, then screenshot or inspect its stories. Fires when the user wants to see, verify, screenshot, or design-check a single component, story, or UI change — phrases like "show me the Button", "screenshot this component's states", "does the calendar section render", "design check-in", "open storybook for just this component", "verify the UI change visually". Runs as a CLI (`storybrokr up <path>`) and as MCP tools (`storybrokr_up`, `storybrokr_get`, `storybrokr_down`, ...). Boots in seconds instead of the minutes a full Storybook takes.
---

# storybrokr

Boots a throwaway Storybook that contains only one component and the components it imports, using the host repo's own `.storybook/` config, addons, and theme. Instances are owned by a local daemon, so they survive your session and are reused across calls.

## When to fire

- The user wants to look at, screenshot, or verify one component or story.
- A design check-in on a UI change.
- You need a stable URL for one story to hand to Playwright or Chrome DevTools.

Do not use it to browse a whole design system: that is what the host's full Storybook is for.

## The loop

1. `storybrokr up <path-to-component-folder-or-story-file> --json` → an instance record. `stories[]` has one entry per story with:
   - `url` — the Storybook manager with that story selected
   - `iframeUrl` — the story alone, no chrome: use this for screenshots
2. `storybrokr screenshot <id> <story-id> --out <abs-path> [--viewport WxH]` for evidence, or `storybrokr check <id>` to run every story's play function headlessly and get pass/fail per story. Both wait for Storybook to report the story rendered; hosts with a Suspense fallback ("Loading translations…") also need `--wait-for-text <expected text>`. Only fall back to loading `iframeUrl` in your own browser when you need to interact beyond what a play function covers.
3. `storybrokr down <id>` when done, or let the 30-minute idle TTL reap it. A second `up` for the same component reuses the instance.

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

## MCP tools

`storybrokr_up { component, hostRoot?, ttlMinutes?, wait? }`, `storybrokr_list {}`, `storybrokr_get { id }`, `storybrokr_down { id }`, `storybrokr_logs { id, tail? }`, `storybrokr_touch { id }`, `storybrokr_inspect_host { path }`. Results are the instance record as JSON text; failures set `isError` with `{ code, message, logTail? }`. `storybrokr_check { id, storyIds?, waitFor?, timeoutMs? }` → `{ instanceId, results: [{ storyId, status: "pass"|"fail"|"timeout", played, durationMs, error? }], summary }`; failing stories are rows, `isError` is only set for instance/browser problems. `storybrokr_screenshot { id, storyId, outPath?, viewport?, clip?, waitFor?, timeoutMs? }` → `{ path, width, height }`; give an absolute `outPath` to write anywhere. `waitFor` is `{ text }` or `{ selector }`.

## Instance record

```json
{ "id": "…", "hostRoot": "…", "component": "components/core/atoms/button", "framework": "@storybook/nextjs",
  "port": 6100, "url": "http://127.0.0.1:6100", "status": "ready",
  "storyFiles": ["…/Button.stories.tsx"],
  "stories": [{ "id": "core-atoms-button--primary", "title": "Core/Atoms/Button", "name": "Primary",
                "url": "http://127.0.0.1:6100/?path=/story/core-atoms-button--primary",
                "iframeUrl": "http://127.0.0.1:6100/iframe.html?id=core-atoms-button--primary&viewMode=story" }] }
```

## Error codes

`HOST_NOT_FOUND`, `HOST_INVALID`, `COMPONENT_NOT_FOUND`, `INSTANCE_CAP_REACHED`, `NO_FREE_PORT`, `BOOT_FAILED` (log tail attached), `BOOT_TIMEOUT` (log tail attached), `INSTANCE_NOT_FOUND`, `DAEMON_UNAVAILABLE`, `INSTANCE_NOT_READY`, `BROWSER_UNAVAILABLE` (installer/launch tail attached), `STORY_NOT_FOUND`, `STORY_FAILED`, `STORY_TIMEOUT`, `SCREENSHOT_WRITE_FAILED`. Run `storybrokr doctor <path>` when a host fails. Transport-level codes `BAD_REQUEST`, `UNAUTHORIZED`, and `NOT_FOUND` mean the request itself was malformed, the token is stale (the client re-reads it once and retries), or the route is unknown.
