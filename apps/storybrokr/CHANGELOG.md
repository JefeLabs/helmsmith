# @helmsmith/storybrokr

## 0.2.0

### Minor Changes

- 380b0c7: `check` and `screenshot` (CLI + MCP): run stories headlessly with pass/fail per story, and write a PNG of one story at a chosen viewport. Adds a `playwright` dependency; Chromium is fetched lazily on first use. New config key `browserIdleMinutes`.

## 0.1.0

### Minor Changes

- 89614cf: Initial release: broker ephemeral single-component Storybook instances from an existing host Storybook — daemon, CLI, and MCP server.
