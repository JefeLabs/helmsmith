---
description: Generate the Date & Time component page — Calendar, RangeCalendar, DatePicker, DateRangePicker, DateField, TimeField.
argument-hint: [--no-dark]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/date-time.pen`.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. If MCP: `get_guidelines({ category: "guide", name: "DatePicker" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Date & Time`** for **{{brand}}**.
> Light + Dark. Use today's date as the rendered "today" anchor for all
> calendars.
>
> ### Calendar (single-month picker)
> Render variants:
> - **Default month view**: today highlighted, one date selected mid-month,
>   weekend column tinted, prior/next-month dates muted
> - **States visible inline**: hover on a future date, focus-ring on a date,
>   disabled past dates (greyed), invalid dates (`--danger-100` background)
> - **Multi-month** (2-up, 3-up) for desktop layouts
> - **Sizes**: `sm` (compact), `md` (default), `lg` (touch-friendly)
> - **With time** — calendar paired with a time-input row at the bottom
> - **With presets sidebar**: "Today / Yesterday / Last 7 days / Last 30
>   days / Custom" left rail
>
> ### RangeCalendar
> - Single-month with a 7-day range selected — show start cap, end cap,
>   intermediate fill, and hover preview when extending the range
> - Dual-month for picking a longer range
> - With presets sidebar (same as Calendar)
> - Invalid range state (start after end → red outline)
>
> ### DatePicker (DatePicker.Root → DateInput → Trigger → Popover → Calendar)
> - Closed states: `default`, `filled`, `focus`, `invalid`, `disabled`,
>   `read-only` for both `outline` and `flat` variants
> - Open state: trigger + popover-anchored Calendar
> - Sizes: `sm`, `md`, `lg`
> - With Description and FieldError
> - Inline variant (calendar always visible, no popover)
>
> ### DateRangePicker
> Same closed-state matrix as DatePicker plus open state showing dual-month
> RangeCalendar. Include a variant with two separate inputs (start / end)
> linked to a single popover.
>
> ### DateField (text-only date input, no popover)
> Three variants showing segmented date input where each segment (DD / MM /
> YYYY) can be focused independently. Show:
> - Empty placeholder
> - Partial fill (only DD focused)
> - Complete value
> - Invalid (one segment red)
> - Locale variants — US (MM/DD/YYYY), ISO (YYYY-MM-DD), EU (DD/MM/YYYY)
>
> ### TimeField
> - 12-hour with AM/PM segment
> - 24-hour
> - With seconds segment
> - With timezone label trailing
> - Compact `sm` and standard `md` sizes
>
> ### Composition examples
> Bottom of page — three real-world patterns:
> 1. "Schedule a meeting" — DateField + TimeField + duration NumberField
> 2. "Booking" — DateRangePicker with night count auto-computed
> 3. "Audit log filter" — DateRangePicker with presets in a Popover
>    triggered from a Toolbar

## Execution

```bash
pencil --out design/components/date-time.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. Validate: today's date is highlighted in every calendar,
RangeCalendar shows a clear selection band, all six DatePicker closed
states present.
