---
description: Generate the Selection component page — Select, ComboBox, Autocomplete, Dropdown, ListBox, TagGroup.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/selection.pen` — selection-family components.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Select" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Selection`** for **{{brand}}**.
> Light + Dark side by side. Component frames named `select`, `combobox`,
> `autocomplete`, `dropdown`, `listbox`, `tag-group`.
>
> ### Select (Select.Root → Trigger → Popover → ListBox)
> A 3×4 grid:
> - Variants: `outline`, `flat`, `faded`
> - States: `default closed`, `open with options`, `selected single`,
>   `disabled`
> - Plus a row showing the **multi-select** mode with chip-styled selected
>   values inside the trigger.
> - Plus a row showing **sectioned** options (option groups with labels) and
>   options with leading icons.
>
> ### ComboBox (text input + filterable popover)
> Three states stacked: `closed empty`, `typing with filtered results`,
> `selection made`. Show one with an "async loading" indicator in the
> popover header.
>
> ### Autocomplete
> Two variants: `single-select` and `multi-select with chips inside the
> input`. Show typing state with a results popover containing 5 suggestions
> and a "no results" empty state.
>
> ### Dropdown (action menu, not selection)
> Demonstrate as an action menu (not a select):
> - Trigger button + open Popover with: standard items (icon + label), a
>   separator, a destructive item (`color="danger"`), a disabled item, a
>   submenu (nested chevron-right), a checkbox item (selected/unselected),
>   and a radio group section.
> - Show the closed state and the open state side by side.
>
> ### ListBox
> Two variants:
> - `single-selection` with 6 items, one selected
> - `multiple-selection` with 6 items, two selected
> Each shows: items with leading icons, items with description text below
> the label, an item with a trailing kbd shortcut hint (`⌘K`), a section
> header, and a separator. Render with virtualization indicator (visible
> scrollbar at the right edge).
>
> ### TagGroup
> Three patterns:
> - **Static** — read-only tags: `default`, `solid`, `bordered`, `flat`
>   variants in a row, each in `default`, `success`, `warning`, `danger` colors.
> - **Removable** — tags with close-button, hover state showing the X.
> - **Selectable** — tags acting as filter chips, single- and multi-select.
>
> ### Spec column
> Right edge: API snippets showing the `.Root → .Trigger → .Popover → .ListBox`
> compound chain for Select, and the equivalent for ComboBox/Autocomplete.

## Execution

```bash
pencil --out design/components/selection.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Confirm at least one popover is rendered open (not collapsed)
for each of Select, ComboBox, Autocomplete, Dropdown, and ListBox.
