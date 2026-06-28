---
description: Generate the icon foundations page (sizes, weights, recommended set, semantic mapping).
argument-hint: [--set lucide|heroicons|gravity-ui|fontawesome] [--family classic|sharp|duotone|sharp-duotone] [--style solid|regular|light|thin]
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/foundations/icons.pen` — the canonical icon reference,
including sizing rules and a curated semantic-action map.

## Pre-flight

1. Read `product/strategy/_context.md` and `product/design/_context.md`.
2. Resolve the icon set in this order:
   - Explicit `--set` flag in `$ARGUMENTS`
   - `iconLibrary` field in `product/.pencil-brand.json` (written by
     `/product:design:foundations:icons-select`)
   - Default to `lucide`
3. If set is `fontawesome`, also read `fontAwesomeFamily`,
   `fontAwesomeStyle`, `fontAwesomeLicense`, and `iconMap` from brand JSON.
   If those fields are missing, suggest running
   `/product:design:foundations:icons-select` first; if the user declines, default
   to Classic Solid (Free) and a built-in FA action map.
4. The semantic action map in Section 3 of the embedded prompt is set-aware:
   - `lucide` / `heroicons` / `gravity-ui` — use the built-in mapping below.
   - `fontawesome` — substitute every action's icon name with the
     corresponding entry from `iconMap`. Render each cell with the FA family +
     style prefix (e.g. `fa-sharp fa-solid fa-pen-to-square`) and the import
     path adapted to the chosen family
     (`@fortawesome/{pro-sharp-solid-svg-icons|free-solid-svg-icons|...}`).

## Embedded prompt

> Build a Pencil page named **`Foundations / Icons`** for the **{{brand}}**
> design system. Selected icon set: **{{set}}**.
>
> ### Section 1 — Size scale
> Render the same icon (use `arrow-right` from {{set}}) at every size in the
> scale, in a row, each labeled with its token:
>
> | Token         | Size | Stroke | Use                            |
> | ------------- | ---- | ------ | ------------------------------ |
> | --icon-xs     | 12   | 1.5    | Inline meta / chips            |
> | --icon-sm     | 16   | 1.5    | Inline body, button-sm         |
> | --icon-md     | 20   | 1.5    | Default UI / button-md         |
> | --icon-lg     | 24   | 1.5    | Section headers / button-lg    |
> | --icon-xl     | 32   | 1.75   | Empty states                   |
> | --icon-2xl    | 40   | 2      | Marketing / hero accents       |
> | --icon-3xl    | 48   | 2      | Onboarding / illustrations     |
>
> ### Section 2 — Weight & treatment
> Three columns showing the same icon (`bell`) in: outline (default),
> filled (`bell-filled` if available, else solid variant), duotone (if {{set}}
> supports it). Each labeled with the import path and a note on when to use
> filled vs outline ("filled = active state, outline = idle").
>
> ### Section 3 — Semantic action map
> A 4-column grid mapping common product actions to specific {{set}} icons.
> Use exactly these mappings (do not substitute):
>
> | Action      | Icon name (lucide)  |
> | ----------- | ------------------- |
> | add         | plus                |
> | edit        | pencil              |
> | delete      | trash-2             |
> | duplicate   | copy                |
> | save        | check               |
> | cancel      | x                   |
> | search      | search              |
> | filter      | sliders-horizontal  |
> | sort        | arrow-up-down       |
> | settings    | settings            |
> | more        | more-horizontal     |
> | menu        | menu                |
> | close       | x                   |
> | back        | chevron-left        |
> | forward     | chevron-right       |
> | expand      | chevron-down        |
> | collapse    | chevron-up          |
> | external    | external-link       |
> | download    | download            |
> | upload      | upload              |
> | share       | share-2             |
> | info        | info                |
> | success     | check-circle-2      |
> | warning     | alert-triangle      |
> | danger      | alert-octagon       |
> | help        | circle-help         |
> | user        | user                |
> | team        | users               |
> | calendar    | calendar            |
> | clock       | clock               |
> | starred     | star                |
> | bookmarked  | bookmark            |
> | locked      | lock                |
> | unlocked    | lock-open           |
>
> If {{set}} is `heroicons` or `gravity-ui`, map the same actions to that
> set's nearest equivalent. Each cell shows the icon at 24px, the action
> label, and the import path (e.g. `lucide-react / Plus`).
>
> ### Section 4 — Pairing rules
> A reference card with three rules:
> 1. Icon size in a button = button height − 12px (approx). Button-md (40px)
>    → icon 20.
> 2. Icon and adjacent text always share the same color token (`--content-1`,
>    `--accent-foreground`, etc.). Never split colors.
> 3. Stroke width is fixed at 1.5 for sizes ≤24, 1.75 at 32, 2 at 40+.

## Execution

```bash
pencil --out design/foundations/icons.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot. The semantic action map should have all listed entries and the
size scale row should show seven sizes.
