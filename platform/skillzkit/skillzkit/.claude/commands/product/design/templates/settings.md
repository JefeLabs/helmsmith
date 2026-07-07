---
description: Generate the settings template — multi-section preferences page with sidebar navigation, tabbed forms, and inline-save patterns. Covers account, security, billing, team, integrations, and notification preferences.
argument-hint: [--sections account,security,billing,team,integrations,notifications,api] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/settings.pen` — the canonical settings
shell with multiple sections users navigate through. Settings is the
most universal authenticated-area template after dashboard and auth.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json`.
3. Read `templates/dashboard.pen` for the app-shell chrome (settings
   uses the same chrome with content-region layout switched to
   master-detail-style nav).

## Embedded prompt

> Build a Pencil page named **`Templates / Settings`** for **{{brand}}**.
> Render at the canonical 3 breakpoints.
>
> ### Shared chrome
>
> Inherit the dashboard chrome (sidebar + top header). Settings
> activates in the user-menu dropdown ("Settings" item) — not in
> the primary sidebar nav. The page itself uses a master-detail
> layout within the dashboard chrome.
>
> ### Layout
>
> Master pane (240px wide on desktop): settings section nav
> Detail pane: the active section's form/content
>
> ### Settings section nav (master pane)
>
> A vertical list of sections with optional grouping:
>
> **Account** group:
> - Profile
> - Email
> - Password
> - Two-factor authentication
>
> **Workspace** group (B2B / multi-tenant):
> - General
> - Members
> - Roles & permissions
> - Billing
> - Usage
>
> **Integrations** group:
> - Connected apps
> - API keys
> - Webhooks
>
> **Preferences** group:
> - Notifications
> - Appearance (theme, density)
> - Language & region
>
> **Danger zone** (red text):
> - Delete account
>
> Active section highlighted. On mobile, master nav is the default
> view; selecting a section navigates to the detail panel.
>
> ### Detail pane variants (rendered as 4 examples)
>
> ### Variant 1 — Profile (form section)
>
> Composition:
> - Section title + description (h2 + body)
> - Avatar upload control: current avatar + change button + remove
>   link
> - Name field
> - Display name field (with helper: "How others see you")
> - Bio textarea (with character counter)
> - Time zone select
> - Save button (sticky to viewport bottom or inline at form end —
>   choose based on form length)
>
> Saved-state pattern: green banner appears at top of section
> ("Saved" with checkmark, auto-dismiss after 3s), uses
> `patterns/banner.pen` status variant.
>
> ### Variant 2 — Two-factor authentication (state-driven section)
>
> Composition varies by current state:
>
> **Not enabled state**:
> - Section title + description
> - "Enable 2FA" CTA card
> - Method options: Authenticator app (TOTP), SMS, Hardware key
>
> **Enabled state**:
> - "✓ Two-factor authentication is enabled" status card
> - Active method shown
> - Backup codes section (with "Regenerate" action)
> - "Disable 2FA" link in danger styling
>
> ### Variant 3 — Members & roles (table-driven section, B2B)
>
> Composition:
> - Section title + description
> - "Invite members" CTA button (right-aligned)
> - Filter / search bar
> - Members table (columns: Avatar, Name, Email, Role, Status,
>   Last active, Actions overflow)
> - Pending invitations section below the active members list
>
> Empty state: "No members yet — invite your team to collaborate"
> uses `patterns/states.pen` never-used variant.
>
> ### Variant 4 — Notifications (toggle-list section)
>
> Composition:
> - Section title + description
> - Sub-sections: "Email notifications", "Push notifications",
>   "In-product notifications"
> - Each sub-section has rows: notification type label + toggle
>   switch (frequency dropdown for some — instant / daily / weekly)
> - "Mute all notifications" master toggle at top
>
> Saves are auto-saved on toggle (no explicit save button) — small
> "Saved" indicator appears after each toggle change.
>
> ### Section 5 — Save patterns reference
>
> A reference card showing when to use each save pattern:
>
> | Pattern                  | When to use                              |
> | ------------------------ | ---------------------------------------- |
> | **Save button**          | Multi-field forms (Profile, General settings) |
> | **Auto-save on change**  | Toggles, single-field changes, preferences |
> | **Confirm before save**  | Destructive or scope-changing (role changes, deletions) |
> | **Save with diff preview** | Settings that affect others (sharing, permissions) |
>
> ### Section 6 — Inline help reference
>
> A reference for inline help patterns within settings:
> - **Field-level helper text** (body-sm below input): brief context
>   for what the field affects
> - **Tooltip** (info icon): for terms users may not know
> - **Learn more link**: external doc link below related field groups
> - **Inline alert** (banner pattern): for risky settings ("Changing
>   your email requires re-verification")
>
> ### Section 7 — Responsive behavior
>
> A canonical-3-breakpoint render:
>
> - Desktop (1440): master nav + detail pane side by side, full
>   form widths
> - Tablet (768): master narrows to 200px, detail takes remainder
> - Mobile (390): master nav is the default view, selecting a
>   section navigates to the detail panel; back button returns to
>   nav
>
> ### Naming
> - Frame names: `settings-{{section-or-variant}}-{{breakpoint}}`
> - Section nav reference: `settings-section-nav`
> - Save patterns reference: `save-patterns-reference`

## Execution

```bash
pencil --out design/templates/settings.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm:
- 4 detail-pane variants rendered (Profile, 2FA, Members, Notifications)
- Section nav covers all canonical groups
- Save patterns reference + inline help reference present
- Canonical 3 breakpoints rendered
