---
description: Pick a Font Awesome family + style for the design system based on a brand brief, generate the FA-flavored semantic action map, and optionally render side-by-side candidates in Pencil.
argument-hint: [brief text or @path/to/brief.md] [--license free|pro] [--render-candidates] [--family classic|sharp|duotone|sharp-duotone] [--style solid|regular|light|thin] [--lock]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Decide which Font Awesome **family** and **style** the design system should
commit to, given a design brief, and persist the choice + the FA-named
semantic action map into `product/.pencil-brand.json` so every other command
(notably `/product:design:foundations:icons`) renders consistently.

This is a **selection** command, not a rendering command. By default it
explains the recommendation and updates brand JSON. With `--render-candidates`
it also writes `design/foundations/icons-candidates.pen` so you can visually
compare three candidate styles before locking in.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve the brief input, in this priority order:
   - Inline `$ARGUMENTS` if it contains free text (or `@path/to/file.md` →
     read that file).
   - Otherwise read `design/brief.md` if it exists.
   - Otherwise read the `tagline`, `industry`, `audience`, `tone` fields from
     `product/.pencil-brand.json`.
   - Otherwise prompt the user for a brief in 2–3 sentences.
3. Resolve license: `--license` flag → else `product/.pencil-brand.json`'s
   `fontAwesomeLicense` field → else default to `free`.
4. If `--family` and `--style` are both passed, **skip analysis** and jump
   straight to the action-map step using that pair.

## Phase 1 — Brief analysis

Extract these dimensions from the brief. If any are unclear, infer from the
strongest signal and note the assumption inline.

| Dimension     | Values                                                                |
| ------------- | --------------------------------------------------------------------- |
| `tone`        | formal • playful • technical • luxurious • friendly • editorial      |
| `industry`    | fintech • health • dev-tools • enterprise-saas • consumer • creative • education • civic |
| `audience`    | technical • general • executive • developer • child-facing • clinical |
| `feel`        | modern • classic • futuristic • warm • precise • illustrative        |
| `density`     | dense (data-heavy) • balanced • generous (marketing-heavy)            |
| `typeShape`   | geometric (sharp) • humanist (rounded) — read from `fontDisplay`     |

Output a short "Read of the brief" block (5 bullets max) before recommending,
so the user can correct any miscalibration before the action map is written.

## Phase 2 — Decision matrix

Apply these rules in order. The first match wins; ties broken by license.

| If the brief is…                                                            | Recommend                  | Why                                                                 |
| --------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| dev-tools • technical • precise • paired with a geometric type (Inter/Geist/IBM Plex) | **Sharp Solid** (Pro) or **Classic Solid** (Free) | Sharp's flat terminals echo geometric type; solid weight reads at small UI sizes |
| fintech • enterprise-saas • formal • dense                                 | **Sharp Regular** (Pro) or **Classic Solid** (Free) | Quieter weight for data-dense screens, sharp lines feel professional |
| editorial • luxurious • generous density                                    | **Classic Light** or **Thin** (Pro) | Lighter strokes feel premium next to large display type             |
| consumer • playful • friendly • child-facing • illustrative                | **Duotone Solid** (Pro) or **Classic Solid** (Free) | Two layers add warmth and brand expression                          |
| creative • marketing-heavy • illustrative + technical voice                | **Sharp Duotone Solid** (Pro) | Hybrid: clean lines + dual layer for big hero moments               |
| health • clinical • civic • accessibility-first                            | **Classic Solid** (any license)             | Highest recognizability, broadest a11y testing                      |
| any case where you're not sure                                              | **Classic Solid** (Free)   | The safest, most legible, broadest-coverage default                 |

License gates:
- `free` → only `Classic Solid`, `Classic Regular`, `Brands` are available.
  If the matrix points at a Pro option, downgrade with a note: *"Pro option X
  recommended for the brief; falling back to Y on Free license. Upgrade unlocks
  X."*
- `pro` → all options available.

Pairing notes to surface in the recommendation:
- Sharp icons + humanist round type → mismatch warning.
- Duotone on light surfaces only → recommend a `--fa-secondary-opacity: 0.4`
  baseline; on dark surfaces use `0.6`.
- Brands family is **always** loaded alongside the chosen primary family for
  social / OAuth icons; never use Brands as the primary.

## Phase 3 — Output the recommendation

Print a concise block:

```
🎯 Recommendation
   Family:  <classic|sharp|duotone|sharp-duotone>
   Style:   <solid|regular|light|thin>
   License: <free|pro>
   Pairs with: <fontDisplay>, <radiusScale>

📐 Reasoning
   <2–4 sentences citing brief dimensions>

🔗 Always loaded alongside: Brands (for social/OAuth)

⚠️  Pairing notes
   <only if there's a real concern, otherwise omit>
```

Unless `--lock` is set, ask the user to confirm or override before writing.

## Phase 4 — FA-flavored semantic action map

Generate the complete map below using the chosen family/style. FA 7 names
(kebab-case). Pro-only icons are flagged; if license is Free, substitute the
listed Free fallback automatically.

| Action       | FA name              | Pro-only? | Free fallback         |
| ------------ | -------------------- | --------- | --------------------- |
| add          | plus                 |           |                       |
| edit         | pen-to-square        |           |                       |
| delete       | trash-can            |           |                       |
| duplicate    | copy                 |           |                       |
| save         | floppy-disk          |           |                       |
| confirm      | check                |           |                       |
| cancel       | xmark                |           |                       |
| search       | magnifying-glass     |           |                       |
| filter       | filter               |           |                       |
| filter-tune  | sliders              |           |                       |
| sort         | arrow-up-arrow-down  |           |                       |
| settings     | gear                 |           |                       |
| more-h       | ellipsis             |           |                       |
| more-v       | ellipsis-vertical    |           |                       |
| menu         | bars                 |           |                       |
| close        | xmark                |           |                       |
| back         | chevron-left         |           |                       |
| forward      | chevron-right        |           |                       |
| expand       | chevron-down         |           |                       |
| collapse     | chevron-up           |           |                       |
| external     | arrow-up-right-from-square |     |                       |
| download     | download             |           |                       |
| upload       | upload               |           |                       |
| share        | share-nodes          |           |                       |
| copy-link    | link                 |           |                       |
| info         | circle-info          |           |                       |
| success      | circle-check         |           |                       |
| warning      | triangle-exclamation |           |                       |
| danger       | octagon-exclamation  | yes       | circle-exclamation    |
| help         | circle-question      |           |                       |
| user         | user                 |           |                       |
| team         | users                |           |                       |
| calendar     | calendar             |           |                       |
| clock        | clock                |           |                       |
| starred      | star                 |           |                       |
| bookmarked   | bookmark             |           |                       |
| locked       | lock                 |           |                       |
| unlocked     | lock-open            |           |                       |
| notification | bell                 |           |                       |
| inbox        | inbox                |           |                       |
| send         | paper-plane          |           |                       |
| attach       | paperclip            |           |                       |
| image        | image                |           |                       |
| folder       | folder               |           |                       |
| file         | file                 |           |                       |
| chart        | chart-line           |           |                       |
| dashboard    | gauge                |           |                       |
| logout       | arrow-right-from-bracket |       |                       |
| login        | arrow-right-to-bracket |         |                       |

Brands list (always loaded): `github`, `google`, `microsoft`, `apple`,
`x-twitter`, `linkedin-in`, `youtube`, `slack`, `discord`, `figma`. Adjust
based on which platforms the brief mentions for OAuth / social / community.

## Phase 5 — Persist to brand JSON

Merge into `product/.pencil-brand.json`:

```jsonc
{
  // ...existing fields preserved...
  "iconLibrary": "fontawesome",
  "fontAwesomeFamily":  "<classic|sharp|duotone|sharp-duotone>",
  "fontAwesomeStyle":   "<solid|regular|light|thin>",
  "fontAwesomeLicense": "<free|pro>",
  "iconMap": {
    "add": { "name": "plus",          "family": "classic", "style": "solid" },
    "edit": { "name": "pen-to-square","family": "classic", "style": "solid" },
    "...": "..."
  },
  "brandsIcons": ["github", "google", "x-twitter", "..."]
}
```

This is the single source of truth other commands read. Specifically:

- `/product:design:foundations:icons` should be invoked next to render the icons
  foundation page in the chosen family/style (it already accepts `--set`;
  pass `--set fontawesome` or update its default to read from brand JSON).
- Component commands (`buttons.md`, `forms.md`, `feedback.md`, etc.) reference
  generic action names (`save`, `close`, `info`) — those resolve through
  `iconMap` automatically when Pencil generates the `.pen`.

## Phase 6 — Optional candidate render

If `--render-candidates` is passed, generate `design/foundations/icons-candidates.pen`
with this prompt:

> Build a Pencil page named **`Foundations / Icons / Candidates`** for
> **{{brand}}**. Render **three vertical columns**, each labeled with a
> candidate `<family>-<style>` pairing (top three by Phase-2 score). Inside
> each column, render the same 16-icon sample at `--icon-md` (20px):
> `house`, `magnifying-glass`, `gear`, `bell`, `user`, `pen-to-square`,
> `trash-can`, `arrow-up-right-from-square`, `chevron-down`, `circle-info`,
> `triangle-exclamation`, `circle-check`, `lock`, `calendar`, `chart-line`,
> `paper-plane`. Below each column, render the same 16 icons at `--icon-lg`
> (24) and `--icon-2xl` (40) so weight differences are visible at scale.
> Mark the recommended column with a `--accent` ring + "Recommended" Badge.
> Render once on Light surface and once on Dark.

After render, screenshot the page and present it inline so the user can
confirm or pick a different column.

## Phase 7 — Install hint (printed, not executed)

Print a copy-pasteable install snippet matching license + framework
(detected from `package.json`):

**React + FA Free**
```bash
npm i @fortawesome/fontawesome-svg-core \
       @fortawesome/free-{{style}}-svg-icons \
       @fortawesome/free-brands-svg-icons \
       @fortawesome/react-fontawesome
```

**React + FA Pro (Kit)**
```bash
npm config set "@awesome.me:registry" https://npm.fontawesome.com/
npm config set "//npm.fontawesome.com/:_authToken" $FONTAWESOME_NPM_AUTH_TOKEN
npm i @awesome.me/kit-{{kit-id}}/icons
```

**HTML / Tailwind v4 only (no React)**
```html
<script src="https://kit.fontawesome.com/{{kit-id}}.js" crossorigin="anonymous"></script>
```

Tailwind v4 utility for sizing (already in `foundations/icons.pen` size
scale): `class="fa-{{family}} fa-{{style}} fa-{name}"` with size set via
`text-[20px]` or the existing `--icon-md` token.

## Phase 8 — Idempotency

If `product/.pencil-brand.json` already has `iconLibrary: "fontawesome"`:
- Without `--lock`: show a diff of what would change and ask before writing.
- With `--lock`: overwrite silently.
- If the chosen family/style is unchanged but the action map gained new
  entries (e.g. you added new actions to the table above), merge in the
  additions and keep existing custom overrides.

## Reporting

End with:

```
✅ Wrote: product/.pencil-brand.json (iconLibrary, iconMap, brandsIcons updated)
↪  Next: /product:design:foundations:icons --set fontawesome
[ if --render-candidates was used ]
🖼  Wrote: design/foundations/icons-candidates.pen
```
