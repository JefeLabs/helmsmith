---
description: Generate the Overlays component page — Modal, AlertDialog, Drawer, Popover, Tooltip.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/overlays.pen` — every floating / portaled
component.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "Modal" })` and
   same for Drawer, Popover, Tooltip.

## Embedded prompt

> Build a Pencil page named **`Components / Overlays`** for **{{brand}}**.
> Light + Dark. Use realistic content — these components are mostly defined
> by their composition with other components.
>
> ### Modal (Modal.Root → Backdrop → Content → Header → Body → Footer)
> Render five sizes side by side, each over a dimmed `--backdrop` rectangle:
> `xs` (320), `sm` (480), `md` (640), `lg` (800), `xl` (1024), `full` (95vw).
> Each shows a complete dialog with: Header (title + close button), Body
> (lorem at body-md), Footer (Cancel + Confirm ButtonGroup right-aligned).
>
> Then render variants:
> - **Centered** (default) vs **top-anchored**
> - **Scrollable body** (header/footer pinned, body overflow auto, with
>   scroll shadow)
> - **With form** (full TextField + TextArea form inside body)
> - **Loading state** (skeleton inside body)
>
> #### Large Organism — `lg`+ and `full` modal at all 3 breakpoints
>
> Per `_context.md` rule 8, modals at `lg` (800), `xl` (1024), and
> `full` (95vw) sizes qualify as Large Organisms (default render
> > 800px). Render the **lg modal with a settings-form body** — a
> realistic Large Modal use case — at all three canonical breakpoints
> stacked vertically (vertical because the modal frames are wide):
>
> - **Desktop (1440)** — modal at 800px width centered in viewport,
>   two-column form layout inside body, full Cancel + Save footer
>   ButtonGroup right-aligned, dimmed backdrop visible around the modal.
> - **Tablet (768)** — modal at 95% of viewport (≈730px) still centered,
>   form collapses from two-column to single-column, footer ButtonGroup
>   stays right-aligned.
> - **Mobile (390)** — modal converts to **bottom-sheet** with drag
>   handle at top, takes ≥75% viewport height, content scrolls within
>   the sheet, footer ButtonGroup becomes full-width stacked
>   (Cancel above, Save below — primary action lower for thumb reach).
>
> Annotate the transitions: `centered modal → bottom-sheet at sm`,
> `2-col form → 1-col at md`, `inline ButtonGroup → stacked full-width
> at sm`.
>
> The other modal sizes (`xs`, `sm`, `md`) render once at default
> width — they're inherently constrained and don't need full
> 3-breakpoint rendering, though they should still convert to a
> bottom-sheet at sm via the standard `sm-and-below: bottom-sheet`
> transition rule (annotate this with a single inline note rather
> than separate frames).
>
> ### AlertDialog
> Four canonical patterns at `sm` size:
> - **Confirm destructive** — title "Delete project?", danger primary action
> - **Confirm neutral** — title "Save changes?", primary action
> - **Inform** — title "Update available", single OK action
> - **Mid-flow choice** — three actions (Save / Don't save / Cancel)
>
> Each with an Icon slot showing the appropriate status icon.
>
> ### Drawer — Large Organism (page-section primitive)
> Per `_context.md` rule 8, the navigation Drawer qualifies as a Large
> Organism (page-section primitive). Render the **right-placement
> navigation drawer** at all three canonical breakpoints stacked
> vertically:
>
> - **Desktop (1440)** — drawer slides in from the right at md size
>   (~360px wide), main content visible behind backdrop on the left.
>   Used as a side panel for filters, details, secondary actions.
> - **Tablet (768)** — drawer takes ~50% viewport (~380px), backdrop
>   dims the remaining 50%. Same content as desktop.
> - **Mobile (390)** — drawer takes the **full viewport** (no
>   backdrop, no underlying content visible). Functions as a full
>   navigation page rather than a side panel. Includes a back/close
>   button in the header since there's no backdrop to dismiss against.
>
> Annotate: `side-panel at lg → full-screen at sm`, `dismiss via
> backdrop click → close button at sm`.
>
> Then render the **other three placements** (`top`, `bottom`, `left`)
> at md size only — single-frame illustrations of the placement
> mechanic, no breakpoint matrix needed for those.
>
> Plus a `right` drawer at `lg` size containing a settings form to
> show drawer-as-wide-side-pane usage (single-frame, desktop only).
>
> ### Popover (Popover.Root → Trigger → Content → Arrow)
> Render eight placements around a central trigger button: `top`, `top-start`,
> `top-end`, `right`, `bottom-start`, `bottom`, `bottom-end`, `left`. Each
> shows a small popover with a title and short copy + arrow pointing back.
> Plus content variants:
> - Compact (single message, no header)
> - Rich (header + body + actions)
> - With form (sign-in micro-form)
>
> ### Tooltip
> Same 8 placements as Popover but tighter copy. Show:
> - Plain (one line)
> - With kbd shortcut hint (`Save  ⌘S`)
> - Multiline (2 lines max)
> - Disabled-trigger tooltip (explaining why the action is unavailable)
>
> ### Stack hierarchy
> Reference card showing z-index relationships from `_context.md`:
> tooltip > toast > modal > overlay > popover > fixed > sticky > dropdown
> > raised > base.

## Execution

```bash
pencil --out design/components/overlays.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: six modal sizes visible, **lg modal rendered at
all three canonical breakpoints with bottom-sheet conversion at
mobile**, four AlertDialog patterns, four drawer placements with
**right-placement navigation drawer rendered at all three canonical
breakpoints with full-screen behavior at mobile**, eight
popover/tooltip placements each.
