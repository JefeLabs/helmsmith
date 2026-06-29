# @jefelabs/tui-view-components

Reusable TUI view components for the AgentX ecosystem. Built on
[openTUI](https://github.com/sst/opentui) + React. Provides
primitives, components, and pre-composed views (`ConnectView`, etc.)
consumed by every toolbox CLI.

## Status: scaffolded

Package shell, peer dependencies, directory structure, and
design-question docstrings are in place. **Implementation pending
design decisions** — see the architectural docstrings in:

- `src/connection.ts` — the `Connection` interface contract
- `src/theme/index.ts` — design tokens and theming approach
- `src/focus/index.ts` — focus management model
- `src/keyboard/index.ts` — keybinding registry
- `src/primitives/index.ts` — Box / Stack / Text atoms
- `src/components/index.ts` — StatusList / SelectList / etc.
- `src/views/index.ts` — ConnectView and friends

Each docstring lists the open design questions and trade-offs for
that subsystem.

## Layered architecture

```
views/      — pre-composed full-screen experiences (ConnectView)
  │
  ├── components/  — opinionated widgets (StatusList, SelectList)
  │     │
  │     └── primitives/  — layout atoms (Box, Stack, Text)
  │
  ├── theme/        — design tokens, ThemeProvider, useTheme()
  ├── focus/        — FocusManager, useFocus()
  └── keyboard/     — KeyboardProvider, useKeybinding()
```

Views compose components. Components compose primitives. All three
read from theme/focus/keyboard contexts.

## Subpath imports

Consumers can import from the root or from subpaths for tree-shaking:

```ts
// Everything (largest bundle)
import { ConnectView, Box, useTheme } from "@jefelabs/tui-view-components";

// Subpath (smaller bundle, finer-grained)
import { ConnectView } from "@jefelabs/tui-view-components/views";
import { Box, Stack } from "@jefelabs/tui-view-components/primitives";
import { useTheme } from "@jefelabs/tui-view-components/theme";
```

## Peer dependencies

`@opentui/core`, `@opentui/react`, and `react` are peer dependencies
— consumers install them. This avoids two React instances coexisting
in a bundle.

## Runtime

Bun-only at runtime. openTUI uses Bun-specific APIs.
