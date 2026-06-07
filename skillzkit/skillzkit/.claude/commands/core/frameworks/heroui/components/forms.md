---
description: Generate the Forms component page — TextField, Input, InputGroup, InputOTP, NumberField, SearchField, TextArea, Checkbox, RadioGroup, Switch, Form primitives.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
requires:
  - design/components/buttons.pen
produces:
  - design/components/forms.pen
---

Generate `design/components/forms.pen` — every form input and its states.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Form" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Forms`** for **{{brand}}**.
> Light + Dark side by side. Use HeroUI v3 compound APIs throughout.
>
> ### TextField (Field.Root → Label → Input → Description / FieldError)
> Render a 4-column grid:
> - **Variants**: `outline` (default), `flat`, `faded`, `underlined`
> - **States** (rows for each variant): `default`, `focus`, `filled`,
>   `invalid` (with FieldError), `disabled`, `read-only`
> - Sizes row: `sm`, `md`, `lg`
> - With Description (helper text) and with FieldError
> - With leading icon (lucide `mail`), trailing icon (lucide `eye-off` for
>   password), and clearable (close-button)
>
> ### Input (low-level, no Label/Description wrapper)
> One row demonstrating `Input` standalone in three sizes.
>
> ### InputGroup
> Render five compositions:
> 1. Prefix text + Input (e.g. `https://` + `acme.com`)
> 2. Input + Suffix text (e.g. amount + `USD`)
> 3. Prefix Button + Input
> 4. Input + Suffix Button
> 5. Prefix Select + Input + Suffix Button (full sandwich)
>
> ### InputOTP
> Three rows: 4-digit, 6-digit, 6-digit with separator dash after position 3.
> Show `default`, `focus`, `filled`, `invalid` states for the 6-digit version.
>
> ### NumberField
> Three variants: with stepper buttons (default), without stepper, with
> custom format (currency $1,234.56 and percentage 42%). Show
> `default`, `focus`, `min`, `max` states.
>
> ### SearchField
> One row: `default`, `typing` (with clear button visible), `loading` (with
> spinner in trailing slot), `with results dropdown` (compose with ListBox).
>
> ### TextArea
> Two variants: `default` (resize-vertical) and `auto-resize`. Show empty,
> filled, disabled, and invalid states. Include a character-count helper
> (e.g. `120 / 280`).
>
> ### Checkbox & CheckboxGroup
> - Single Checkbox: `unchecked`, `checked`, `indeterminate`, `disabled`,
>   `invalid` for all three variants (`solid`, `outline`, `flat`).
> - CheckboxGroup vertical (3 options) and horizontal (3 options) layouts.
>
> ### RadioGroup
> Vertical and horizontal, each with 4 options. Show `default`, `selected`,
> `focus`, `disabled`, `invalid` states. Include a "card-style" RadioGroup
> variant where each option is a selectable card (common HeroUI pattern).
>
> ### Switch
> Three sizes (`sm`, `md`, `lg`). Each in `off`, `on`, `disabled-off`,
> `disabled-on`. One row showing Switch with leading label vs trailing label
> (`Switch.Label` + `Switch.Description`).
>
> ### Form layout reference
> One full example at the bottom: a "Profile settings" form using `<Form>`,
> `<Fieldset>`, `<Form.Row>`, mixing TextField, NumberField, Switch,
> RadioGroup, and a submit ButtonGroup. Rendered at 640px column width to
> show real-world spacing.

## Execution

```bash
pencil --out design/components/forms.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: all four TextField variants × six states present,
InputGroup five compositions visible, the "Profile settings" example
renders without overflow at 640px.
