---
description: Generate the banner pattern page (announcement, cookie consent, status banner, deprecation notice, marketing banner). Establishes reusable interruption / notification compositions that respect user attention without abusing it.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/patterns/banner.pen` — five banner patterns covering
the major interruption / notification cases. Banners are
attention-stealing by design; standardizing the patterns keeps that
attention-spend bounded and intentional.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.

## Embedded prompt

> Build a Pencil page named **`Patterns / Banner`** for **{{brand}}**.
> Single 1440-wide canvas, 64px outer padding, 80px between rows.
> Render once on Light and once on Dark.
>
> ### Pattern 1 — Announcement banner
>
> A thin horizontal bar at the top of the page (40–60px tall):
> - Background: `--color-accent-100` (info) or `--color-accent-700`
>   (high-emphasis announcements)
> - Centered or left-aligned content: short message + inline CTA
>   link
> - Optional dismiss "×" on the right
>
> Variants:
> - **Persistent**: no close button. Used for permanent affordances
>   like "Currently in beta — feedback welcome".
> - **Dismissible**: × close. Dismissal stored in localStorage with
>   announcement ID + timestamp. Re-show only when ID changes
>   (new announcement) or N days pass (configurable).
> - **High-emphasis**: dark accent background, white text, small
>   icon. Used for major announcements (new feature launch, sale,
>   deadline approaching).
>
> Use when: launching a new feature, time-sensitive promotion,
> known issue notification, account-wide notice.
>
> ### Pattern 2 — Cookie consent banner
>
> A bottom-fixed bar (or modal in strict-consent regions):
> - Brief copy explaining cookie use (~30 words)
> - Three actions: "Accept all" (primary), "Reject all" (secondary),
>   "Customize" (link to detailed preferences)
> - Optional inline preference toggles for granular consent
>   (essential / analytics / marketing) when GDPR-strict
>
> Variants:
> - **Bottom bar**: less intrusive, suitable for non-EU markets
>   where opt-out is acceptable
> - **Modal blocker**: required for GDPR / EU markets, blocks
>   interaction until choice made
> - **Granular preferences**: expanded modal with per-category
>   toggles
>
> Watch: cookie consent is regulatory, not optional. If shipping
> in EU markets, the modal-blocker variant + granular preferences
> are required (GDPR Art. 7). Never auto-accept on behalf of users.
>
> ### Pattern 3 — Status banner (degraded service / outage)
>
> A horizontal bar (60–80px tall):
> - Icon (info / warning / error per status severity)
> - Status message + link to status page
> - Optional ETA if known
> - Color: `--color-warning-100` for degraded, `--color-danger-100`
>   for outage
>
> Variants:
> - **Top of page**: most visible, surfaces immediately on load
> - **Inline within affected section**: scoped to where the issue
>   manifests (e.g. only the page that uses the broken integration)
> - **Persistent until resolved**: wired to a status feed; auto-
>   removes when status returns to operational
>
> Use when: known service degradation or outage that affects user
> task completion. Status banners build trust by being honest;
> hiding outages erodes it.
>
> ### Pattern 4 — Deprecation notice
>
> A more substantive banner (80–120px tall):
> - Icon + headline ("This feature will be removed on [date]")
> - Brief explanation + link to migration guide
> - "Got it" dismiss + "Migrate now" CTA
> - Color: `--color-warning-100` background, `--color-warning-900` text
>
> Variants:
> - **Soft warning** (90+ days out): info coloring, dismissible
> - **Hard warning** (30 days or less): warning coloring, dismissible
>   but re-shows after 7 days
> - **Final warning** (7 days or less): danger coloring,
>   non-dismissible, blocks until acknowledged
>
> Use when: API endpoints, settings, features being phased out.
> Deprecation notices respect user time when they're informative
> early and demanding only as the deadline approaches.
>
> ### Pattern 5 — Marketing banner / promo bar
>
> A full-width announcement bar similar to Pattern 1 but with
> commercial intent:
> - Bold copy + clear value ("Save 20% on annual plans this week")
> - Strong CTA ("Get the deal")
> - Optional countdown timer for urgency
> - Background: gradient using brand colors, or `--color-accent-700`
>
> Variants:
> - **Top-of-page persistent**: always visible during promo window
> - **Top-of-page dismissible**: respects user choice to hide
> - **Bottom slide-up**: appears after scroll-depth or time-on-page
>   threshold
>
> Use when: time-bounded promotions, launch announcements, cross-
> sell prompts.
>
> Watch: marketing banners abuse user attention if overused. Keep
> at most one active marketing banner at a time. Set a frequency
> cap (e.g. "show this banner at most once per week per user").
>
> ### Section 6 — Banner-stack policy
>
> A reference card describing what to do when multiple banners
> qualify to display simultaneously:
>
> Priority order (highest first):
> 1. **Status banner** — outage / degraded service
> 2. **Cookie consent** — regulatory, must show on first visit
> 3. **Deprecation hard / final warning** — user action required
> 4. **Announcement banner** — important product news
> 5. **Marketing banner** — commercial intent
>
> Display rule: only the highest-priority eligible banner shows
> at a time. Lower-priority banners queue and surface after
> the higher one is dismissed (with a 30-second delay so the user
> isn't bombarded).
>
> Maximum visible: ONE banner. Stacking banners destroys the
> attention they're meant to capture.
>
> ### Section 7 — Dismissal persistence
>
> Reference card:
>
> | Banner type        | Dismissal scope          | Re-show trigger |
> | ------------------ | ------------------------ | --------------- |
> | Announcement       | Per-announcement ID      | New ID, or N days configurable |
> | Cookie consent     | Per-domain, persistent   | Cookie expiry only |
> | Status (operational) | Auto-removes on resolve | N/A |
> | Status (persistent issue) | Per-session         | New session |
> | Deprecation soft   | Per-feature, N days       | After N days repeats |
> | Deprecation hard   | Cannot dismiss            | N/A |
> | Marketing          | Per-campaign ID           | New campaign |
>
> ### Section 8 — Accessibility
>
> Reference card:
> - Banners use `role="region"` with `aria-label` describing the
>   announcement
> - Status banners use `aria-live="polite"` (or `assertive` for
>   outages) so screen readers announce changes
> - Dismiss buttons have `aria-label` ("Dismiss announcement")
> - Banner content respects `prefers-reduced-motion` (no
>   slide-in animation if reduce is set)
> - Non-essential banners are excluded from skip-link targets
>
> ### Section 9 — Responsive behavior
>
> A 3-row strip showing patterns at desktop / tablet / mobile:
> - Top bars: same height across breakpoints; copy may truncate
>   on mobile (test for 390px width)
> - Cookie modal: side margins shrink on mobile; granular toggles
>   stack vertically
> - Status banners: icon + text always visible; ETA may collapse
>   on mobile
> - Deprecation: 2-line on desktop, may need 3-line on mobile
> - Marketing: countdown timer hides on mobile if cramped
>
> ### Naming
> - Pattern frames: `banner-{{pattern}}` (`-announcement`,
>   `-cookie-consent`, `-status`, `-deprecation`, `-marketing`)
> - Reference frames: `stack-policy`, `dismissal-persistence`,
>   `banner-a11y`
> - Responsive cells: `banner-{{pattern}}-{{breakpoint}}`

## Execution

```bash
pencil --out design/patterns/banner.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 5 banner patterns rendered, stack
policy + dismissal persistence + a11y reference cards, responsive
matrix complete.
