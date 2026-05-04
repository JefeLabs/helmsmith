---
description: Generate the profile / account page template — user-facing profile with viewing affordances + editing modes. Distinct from settings (settings = preferences; profile = identity / public-facing). Includes K-12 with-guardian-access variant.
argument-hint: [--with-guardian-access] [--fidelity low|hi]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/templates/profile.pen` — the user-facing profile
page. Different from settings: settings is preference management,
profile is identity. Profile pages are often shareable / public-
facing (e.g. /username) while settings is always private.

For K-12 ed-tech products, include the
`with-guardian-access` variant (guardians have view + limited edit
on student profiles).

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Read `product/.pencil-brand.json` for `audience-regulation`.
3. Read `templates/dashboard.pen` for chrome.

## Embedded prompt

> Build a Pencil page named **`Templates / Profile`** for **{{brand}}**.
> Render at the canonical 3 breakpoints.
>
> ### Layout
>
> Inside dashboard chrome.
>
> ### Variant 1 — Profile view (own profile)
>
> Composition:
> - **Header banner**: cover image (optional, 1440×280) +
>   profile picture (large, 160×160) overlapping
> - **Identity row**: name (h1) + handle/username + role/title +
>   verification badge (if applicable)
> - **Action row** (right): "Edit profile" button + share menu
> - **Bio section**: 1–3 paragraphs of self-description
> - **Stats row**: 3–4 key stats (joined date, contributions,
>   followers — context-dependent)
> - **Tabs**: Activity, Posts, Followers, About (or context-specific)
> - **Tab content**: the active tab's data list/grid
>
> ### Variant 2 — Profile view (other user's profile)
>
> Same as Variant 1 with adjustments:
> - "Edit profile" replaced with "Follow" / "Connect" / "Message"
>   action button (per product)
> - Some sections may be hidden based on the viewer's permissions
>   (private email, etc.)
> - Optional "More from this user" related-content section at
>   bottom
>
> ### Variant 3 — Profile edit mode
>
> Same composition but with editable affordances:
> - Cover image: upload control overlay on hover
> - Profile picture: upload + crop controls
> - Name + bio + other fields: inline-editable
> - Save / Cancel buttons appear in action row
>
> Auto-save on blur for short fields; explicit save for bio /
> longer content.
>
> ### Variant 4 — Public profile page (when applicable)
>
> Some products have public profile pages reachable at a URL like
> `/u/username`. Composition:
> - Marketing-style header (no app chrome)
> - Larger banner / hero treatment
> - SEO meta tags rendered into the page (title, description,
>   social preview)
> - Privacy-respecting (only fields user marked public are shown)
>
> ### Variant 5 — Guardian access (K-12, when --with-guardian-access)
>
> For K-12 ed-tech products: guardians have a special view of
> their student's profile.
>
> Composition adjustments:
> - Banner shows: "Viewing [student name]'s profile as guardian"
> - Identity row + bio + stats (read-only or guardian-editable per
>   policy)
> - **Guardian-only sections**:
>   - Academic progress (grades, attendance — guardian view)
>   - Communications (messages from teachers)
>   - Forms requiring signature (consent forms, field trip permissions)
> - **Privacy boundary**: indicate which sections the student sees
>   vs which are guardian-only
> - **Action row**: "View as student" toggle + "Communications"
>   link
>
> ### Section 6 — Privacy controls reference
>
> A reference card showing field-level privacy controls:
>
> | Visibility option        | Who can see                                |
> | ------------------------ | ------------------------------------------ |
> | **Public**               | Anyone with the URL (search-engine indexable) |
> | **Authenticated**        | Any signed-in user                         |
> | **Connections only**     | Followers / connected users                |
> | **Workspace members**    | Members of the same workspace (B2B)        |
> | **Family members**       | Connected family members (K-12, consumer)  |
> | **Private**              | Owner only                                 |
>
> Per-field visibility controls live in profile edit mode.
>
> ### Section 7 — Empty / loading / error states
>
> - **Empty profile (new user)**: "Complete your profile to help
>   others recognize you" with progress nudge
> - **Loading**: skeleton (banner + circle + text rows)
> - **Profile not found**: 404-style empty state
> - **Permission denied (private profile)**: "This profile is
>   private" with no further info
>
> ### Section 8 — Responsive behavior
>
> A canonical-3-breakpoint render:
>
> - Desktop (1440): banner + full identity row + tabs side-by-side
> - Tablet (768): banner crops slightly, profile picture overlap
>   reduces, tabs may scroll horizontally
> - Mobile (390): banner becomes shorter, profile picture sized
>   down to 96×96, tabs scroll horizontally, action row collapses
>   into menu
>
> ### Naming
> - Frame names: `profile-{{variant}}-{{breakpoint}}`
>   (e.g. `profile-view-own-desktop`, `profile-edit-mobile`)
> - Reference frames: `privacy-controls`, `with-guardian-access`
>   (when flag set)

## Execution

```bash
pencil --out design/templates/profile.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm: 4 base variants + 1 conditional
(guardian-access) per flag, privacy controls reference card,
canonical 3 breakpoints rendered.
