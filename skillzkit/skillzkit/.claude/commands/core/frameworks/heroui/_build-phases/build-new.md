---
description: Build phase reference — Path B, build a new component (Step 3 of /core:frameworks:heroui:build-components). Applies the HeroUI v3 → RAC → react-aria hooks → custom cascade in strict order, then runs the build loop with pixelmatch design-fidelity gating. Loaded by the orchestrator when no match is found or --mode rebuild is set; not invoked directly.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

# Build phase — Path B: build a new component (Step 3)

Triggered when no match is found, or `--mode rebuild` is set.

1. **Apply the cascade** in strict order. Pick the first match and
   record the level used:

   | Level | Library | Heuristic |
   | ----- | ------- | --------- |
   | 1 | `@heroui/react@beta` | Component name or close synonym is exported from HeroUI v3. Use as-is with `classNames` overrides + `tailwind-variants` composition for any extension. |
   | 2 | `react-aria-components` | RAC exports a primitive matching the behavior (e.g. `<ToggleButton>`, `<DisclosurePanel>`). Wrap with `tv()` for styling, expose a `classNames` slot prop. |
   | 3 | `@react-aria/*` `use-*` hooks | Behavior available as a hook (`useButton`, `useTextField`, `useFocusRing`). Build custom DOM with the hook providing ARIA props. |
   | 4 | Custom + WAI-ARIA | None of the above fit. Build raw, follow the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/) pattern for the component type. Document in a `// Reason:` comment why levels 1–3 didn't apply. |

2. **Build inside-out** (this matches the user's spec):
   - Identify the Pencil frame's box model: padding, border, margin,
     size (W × H), color (fill, stroke, text). Pull these from the
     frame metadata, not by visual inspection.
   - Identify state-dependent styling: hover, focus, active, disabled,
     loading, error.
   - Compose using `tailwind-variants`:
     ```tsx
     import { tv, type VariantProps } from 'tailwind-variants';
     import { Button as RACButton } from 'react-aria-components';
     import { cn } from '@/lib/utils';

     const button = tv({
       slots: { base: 'inline-flex items-center justify-center …', icon: 'h-4 w-4', label: '' },
       variants: {
         variant: { solid: { base: 'bg-accent text-accent-foreground …' }, … },
         size:    { sm: { base: 'h-8 px-3 text-sm' }, md: { base: 'h-10 px-4' }, … },
       },
       defaultVariants: { variant: 'solid', size: 'md' },
     });
     ```
   - **Placeholder images**: for any media slot in the design (avatars,
     hero images, product photos), emit a placeholder using a deterministic
     service URL derived from the slot name, OR write a local SVG
     placeholder to `public/placeholders/<slot>.svg` and reference it.
     Never inline `data:` URIs — they bloat the component.

3. **Build loop** (max 5 iterations):
   1. Write or update the implementation file.
   2. Write or update the Storybook story (`<component>.stories.tsx`)
      with one story per variant × state combination from the Pencil
      frame's matrix. Use `args` for variants, not separate stories
      per state when the same render serves both.
   3. Run `npm run build-storybook` (or `start-storybook` headless).
   4. Screenshot the canonical story via Playwright at the same
      dimensions as the Pencil frame.
   5. Pixelmatch against `tests/__pencil__/<comp>/design.png` with
      `$designVariance` threshold.
   6. **Exit when diff ≤ designVariance**. On failure, the diff PNG
      shows where pixels disagree — narrow to that region (padding off?
      wrong border-radius? off-by-one in font size?) and adjust.
   7. **Hit max iterations**: stop, print diff, ask the user.