---
description: Generate the error page templates — 404, 403, 500, 503, offline, generic — using HeroUI v3.
argument-hint: [--codes 404,403,500,503,offline,generic] [--with-illustration] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/error.pen` — a single `.pen` containing every
error-page variant, each on its own page within the file.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Default codes to render: `404, 403, 500, 503, offline, generic` unless
   `$ARGUMENTS` overrides.
3. If MCP: `get_guidelines({ category: "guide", name: "Error Page" })`.

## Embedded prompt

> Build a multi-page Pencil document for **{{brand}}** containing one page
> per error code. For each code in **{{codes}}**, create a Pencil page named
> **`Templates / Error / {{code}}`**. Per `_context.md` rule 8 (Templates
> tier), render each error page **at all three canonical breakpoints**:
> `Mobile (390)`, `Tablet (768)`, and `Desktop (1440)`, side by side.
>
> ### Shared layout (all error pages)
> A centered Surface card on a `--background` page. Card width:
> `min(560, 100% - 32)`. Inside, vertically centered:
>
> 1. **Status code** — display-2xl (desktop) / display-xl (mobile),
>    color-tinted per severity:
>    - `404` → `--content-2` (informational, neutral)
>    - `403` → `--warning-700`
>    - `500` → `--danger-700`
>    - `503` → `--warning-700`
>    - `offline` → `--content-3`
>    - `generic` → `--content-2`
> 2. **Optional illustration** (only if `--with-illustration`) — 200px
>    square SVG placeholder above the status code, with a comment
>    indicating which lucide icon or asset slot to use:
>    - 404 → `compass`
>    - 403 → `lock`
>    - 500 → `server-crash`
>    - 503 → `cloud-off`
>    - offline → `wifi-off`
>    - generic → `triangle-alert`
> 3. **Headline** (h2) — copy per code:
>    - 404 → "We couldn't find that page"
>    - 403 → "You don't have access to this"
>    - 500 → "Something went wrong on our end"
>    - 503 → "{{brand}} is temporarily unavailable"
>    - offline → "You're offline"
>    - generic → "An unexpected error occurred"
> 4. **Body** (body-md, max-width 480) — supportive sentence + a
>    suggestion. For 500/503, include a small Code text-block (`Surface`
>    with `--font-mono`) showing the error reference: `Reference:
>    REQ-7f3a9c`. For 503, add a "Status page" link.
> 5. **Action row** — primary Button + secondary Link, gap-3:
>    - 404 → primary "Back home" / link "Search instead" (opens search
>      Modal)
>    - 403 → primary "Sign in" / link "Request access"
>    - 500 → primary "Try again" / link "Contact support"
>    - 503 → primary "View status" / link "Try again in a minute"
>    - offline → primary "Retry" / link "View offline content"
>    - generic → primary "Reload" / link "Go home"
> 6. **Persistent chrome** — a minimal Toolbar at the very top of the
>    viewport (logo + "Sign in" button or status indicator). Footer is
>    omitted on error pages to keep focus on the message.
>
> ### State variants per page
> Below the main rendering, include three smaller variant cards:
> - **Inline error** — same content but rendered as an Alert inside a
>   parent surface (for inline errors within an app shell)
> - **Modal error** — same content rendered as an AlertDialog
> - **Toast error** — same content as a danger Toast for transient errors
>
> ### Status banner pattern (extra)
> On the `503` page only, add a section showing the "scheduled maintenance"
> banner pattern: a full-width Surface tinted `--warning-50` at the top of
> a normal app layout, with countdown text and a dismiss CloseButton.
>
> ### Naming
> - Pages: `Templates / Error / 404`, `... / 403`, etc.
> - Frames per page: `error-card`, `chrome-toolbar`, `inline-variant`,
>   `modal-variant`, `toast-variant`.

## Execution

```bash
pencil --out design/templates/error.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page list. Confirm a page exists for each requested code,
and that the 503 page includes the maintenance-banner pattern. If the
illustration flag was set, verify icons match the mapping above.
