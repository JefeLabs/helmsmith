---
description: Build phase reference — interaction tests (Step 4 of /core:frameworks:heroui:build-components). For components with interactive behavior, generates or updates tests using Playwright Component Tests, Storybook play(), or the project-configured runner. Includes axe-core a11y assertions on every test. Loaded by the orchestrator after the responsive gate passes; not invoked directly.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

# Build phase — interaction tests (Step 4)

Triggered when the component has interactive behavior. Skip with
`--no-interaction-tests`.

Interactive component types and their canonical test sets:

| Component family       | Test cases                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| Button / IconButton    | click fires, Enter/Space activates, disabled blocks, aria-pressed (toggle)  |
| TextField / TextArea   | typing updates value, focus management, invalid state announces, clear works |
| Select / ComboBox      | open via click + keyboard, ↑↓ navigation, Enter selects, Esc closes, type-ahead |
| Dialog / AlertDialog   | focus trap, Esc closes, return-focus on close, aria-modal, body scroll lock |
| Drawer / Popover       | open/close, focus management, click-outside dismiss, aria-expanded         |
| Tabs                   | ←→ navigation, Home/End, aria-selected, panel association                  |
| Checkbox / Switch / Radio | space toggles, group navigation, aria-checked / aria-pressed              |
| Form                   | submit, validation messaging, focus-on-error                                |
| Table                  | sort triggers, selection (row + all), keyboard nav of cells (where applicable) |
| Disclosure / Accordion | toggle, multiple-vs-single mode, aria-expanded                              |

For each applicable case:

1. **Generate or update the test file**:
   - If Playwright Component Tests is set up: emit
     `<component>.spec.tsx`.
   - Else if a project-specific component test runner is configured:
     emit using its API.
   - Else: emit a Storybook `play()` function on the relevant story.
2. **Run the test loop** (max 5 iterations):
   1. Run the test runner.
   2. On failure, identify the failing assertion and fix the
      implementation (not the test). Rerun.
   3. Exit when all interaction tests pass.
3. **Always include axe-core a11y assertion** at the end of every
   interaction test:
   ```ts
   await expect(page).toPassA11yChecks(); // axe-core wrapper
   ```