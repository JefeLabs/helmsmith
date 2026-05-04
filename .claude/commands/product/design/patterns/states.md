---
description: Generate the cross-cutting state patterns page (empty / loading / error / optimistic states). Establishes a single reference for how content-absent, content-loading, content-failed, and content-pending states render across the system. Components reference this rather than reinventing each state ad-hoc.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/states.pen` — the canonical reference for
the four cross-cutting UI states every product hits: **empty**,
**loading**, **error**, and **optimistic-pending**. Without a single
reference, each component invents its own approach and the system
feels inconsistent within five components.

This is the first command under the new `patterns/` folder, which
sits between `components/` (atomic units) and `templates/` (whole
pages). Patterns are composed sections that components reference and
templates consume.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`. The `imagery.direction` value
   informs the empty-state and error-state illustration sourcing —
   if the brand uses illustrated imagery, empty/error states will use
   matching spot illustrations from `imagery.assets["empty-state"]`
   and `imagery.assets["error-state"]`. If the brand uses photography,
   empty states use abstract pattern backgrounds (no photos of
   confused people in empty states).

   **Asset key contract**: this pattern reads specific keys from
   `imagery.assets`:
   - `imagery.assets["empty-state"]["never-used"]`
   - `imagery.assets["empty-state"]["filtered"]`
   - `imagery.assets["empty-state"]["welcome"]`
   - `imagery.assets["empty-state"]["inbox-zero"]`
   - `imagery.assets["error-state"]["page-error"]`
   - `imagery.assets["error-state"]["section-error"]`
   - `imagery.assets["loading-state"]["skeleton-pattern"]`
   - `imagery.assets["success-state"]["checkmark-celebrate"]`
   - `imagery.assets["success-state"]["completion"]`

   Each asset entry contains `vendor`, `url`, and `license`
   (see `foundations/imagery-select.md` for the full schema).
   If a key is missing, audit Plane 7 surfaces it as a
   missing-asset warning and the rendered states fall back to the
   pattern background treatment (no illustration).
3. If MCP: `get_guidelines({ category: "guide", name: "States" })`.

## The four states

| State        | When to use                                              |
| ------------ | -------------------------------------------------------- |
| **Empty**    | Content doesn't exist (no records yet, filtered to nothing, brand-new account, never-used feature) |
| **Loading**  | Content is being fetched (initial load, pagination, search execution, async re-fetch) |
| **Error**    | Content failed to load OR an action failed inline (network failure, validation error, permissions denial) |
| **Optimistic** | Action initiated, UI shows the assumed result before server confirms (likes, toggles, edits, drag-reorder) |

## Embedded prompt

> Build a Pencil page named **`Patterns / States`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between sections.
> Render once on Light and once on Dark.
>
> ### Section 1 — Empty states
>
> Four empty-state variants demonstrating different scenarios:
>
> 1. **Never-used feature** ("No saved searches yet")
>    - Friendly illustration / pattern (per `imagery.direction`)
>    - Helpful one-liner: "Save searches to find them faster next time."
>    - Primary CTA: "Save your first search"
>    - Compositional weight: ~60% of containing space, centered
>
> 2. **Filtered to nothing** ("No results match")
>    - Smaller treatment than never-used (less visual weight)
>    - Helpful one-liner with the active filter as text: "No results
>      for status='active' in the last 30 days."
>    - Two actions: "Clear filters" (primary) + "Adjust filters"
>      (secondary)
>
> 3. **Brand-new account** ("Welcome to {{brand}}")
>    - Maximum visual weight — full-page illustration or hero pattern
>    - Onboarding nudge: "Let's get started." with 3 quick-start cards
>    - Optional secondary: "Skip for now" link
>
> 4. **Empty by design** ("Inbox zero")
>    - Celebratory treatment: "All caught up!"
>    - Minimal illustration, optimistic copy
>    - No primary action — this is a positive state
>
> Each variant rendered at 480×360 in a 4-column grid. Annotate
> compositional weight (60% / 40% / full / minimal) and the
> illustration source (per the brand's imagery direction).
>
> ### Section 2 — Loading states
>
> Three loading-pattern variants, each demonstrating when to use it:
>
> 1. **Skeleton** — for content with predictable shape (cards,
>    rows, profile blocks). Match the eventual content's layout
>    closely — same proportions, same typography heights, same image
>    aspect ratios. Use `--color-neutral-100` for skeleton blocks
>    in light, `--color-neutral-800` in dark, with a subtle shimmer
>    animation that respects `prefers-reduced-motion`.
>
> 2. **Spinner** — for non-shape-predictable async (form submit,
>    button-press in-flight, indeterminate operations). 24px default,
>    centered in the affected region, accompanied by a label when
>    >1s wait expected ("Saving...").
>
> 3. **Progress bar** — for operations with known progress (file
>    upload, multi-step task, pagination cursor). Determinate
>    (with %) when known, indeterminate (animated) when not.
>
> Render each pattern in a 320×240 demo card with a "Use when"
> annotation:
> - Skeleton: shape predictable, expected wait 0.3–3s
> - Spinner: shape unpredictable OR action-feedback, expected wait
>   0.5–5s
> - Progress bar: long-running known-progress (>5s) OR
>   long-running indeterminate
>
> Below the three: a decision tree:
>
> ```
> Loading something?
> ├── Will the result have a predictable layout (list, card grid)?
> │   ├── Yes → Skeleton matching the eventual layout
> │   └── No → Continue
> └── Is progress measurable (% complete, step n of m)?
>     ├── Yes → Determinate progress bar
>     └── No → Continue
>     └── Wait expected < 0.5s? → Skip indicator (optimistic)
>     └── Wait expected 0.5-5s? → Spinner with optional label
>     └── Wait expected > 5s? → Indeterminate progress bar with
>                               estimate or "Working..." status
> ```
>
> ### Section 3 — Error states
>
> Three error-state variants, scoped by where the error occurred:
>
> 1. **Inline field error** — within a form, attached to one field
>    - Red `--color-danger-600` text below the field
>    - Icon (warning-triangle) + concise message
>    - Field border shifts to `--color-danger-500`
>    - Maintains field's other state (focus, etc.)
>
> 2. **Section / card error** — within a region, recoverable
>    - Replace the section's content with: warning illustration,
>      "Couldn't load [thing]" message, retry button
>    - Doesn't disrupt the rest of the page
>    - Card stays in its layout slot — the failure is contained
>
> 3. **Page-level error** — the whole route failed
>    - Distinct from the `templates/error-page.pen` (which is
>      404/403/500 server-side). Page-level errors here are
>      client-side: API down, auth expired, network offline
>    - Friendly illustration matching imagery direction
>    - "Something went wrong" + concise actionable message
>    - Two actions: retry + report
>
> Render each in a 480×320 card with annotation: "scope: field /
> section / page", "recoverable: yes / no", "matches `templates/
> error-page` when no?".
>
> ### Section 4 — Optimistic states
>
> Three optimistic-pending patterns, demonstrating different
> rollback strategies:
>
> 1. **Simple optimistic** — UI updates immediately, server confirms
>    in background. Examples: like buttons, toggle switches, sort
>    column reorder.
>    - Show the optimistic state visually identical to the
>      committed state — no spinner, no opacity dimming
>    - On server failure: show toast + revert
>    - Annotate: "rollback path: toast + revert"
>
> 2. **Optimistic with pending indicator** — UI updates immediately
>    but with a subtle pending hint. Used when the operation is
>    high-stakes enough that users want to see "still saving".
>    - 70% opacity OR a small pulsing dot in the corner OR a
>      progress dot trailing the touched element
>    - On confirmation: remove the indicator
>    - On failure: revert + toast
>    - Annotate: "rollback path: revert + toast; visual hint
>      reduces surprise on rollback"
>
> 3. **Optimistic with undo** — for destructive actions where
>    immediate rollback is hostile. Show the optimistic state +
>    a toast with "Undo" affordance + 5-second timer.
>    - Used for: delete, archive, mark-as-read on items the user
>      can recover
>    - Server-side write happens after the timer expires (not
>      immediately) so undo is genuinely reversible
>    - Annotate: "rollback path: explicit user choice within window"
>
> Render each in a 400×300 demo with the rollback path called out.
>
> ### Section 5 — State transitions
>
> A flow diagram showing the canonical state-machine for content:
>
> ```
> [initial] → loading → success ────→ committed
>                  │                       │
>                  └→ error              optimistic
>                     │                       │
>                     └→ retry              committed
>                                              │
>                                              └→ failure → revert → error
> ```
>
> Annotate transition triggers and which state's pattern (Section
> 1–4) applies at each node.
>
> ### Naming
> - Section frames: `empty-states`, `loading-states`, `error-states`,
>   `optimistic-states`, `state-transitions`
> - Per-variant frames: `empty-{{variant}}`, `loading-{{variant}}`, etc.
> - All demo content references real product scenarios from
>   `{{brand}}`, not lorem

## Execution

```bash
pencil --out design/patterns/states.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm:
- 4 empty-state variants with compositional weight annotations
- 3 loading patterns + decision tree for choosing among them
- 3 error scopes (field / section / page) with recoverability notes
- 3 optimistic patterns with rollback paths called out
- State-transition flow diagram at the bottom

## Component contract

After this foundation is written, every component that has any of
these states references this pattern document:

- **Lists, tables, grids**: use the matching empty-state variant
  (filtered-to-nothing if the list has filters; never-used if not)
- **Async fetches**: use the loading-pattern decision tree to pick
  between skeleton / spinner / progress
- **Form submission**: inline field errors + section error on submit
  failure
- **Mutations**: pick optimistic strategy per action stakes (simple
  for toggles, pending-indicator for saves, undo for destructive)

## Audit hook

`/audit` Plane 1 (code drift) extends with a **states-pattern**
sub-check: every list / form / async component in the manifest must
import or reference one of the four state patterns. Components that
implement empty / loading / error / optimistic ad-hoc are flagged for
review.
