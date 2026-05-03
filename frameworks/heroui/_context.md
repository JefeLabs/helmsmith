# HeroUI v3 — Stack Context

> Read this in addition to `product/strategy/_context.md` whenever any
> `/frameworks:heroui:*` command runs, or any pattern/template generation
> step references HeroUI components.
>
> This file documents the **HeroUI v3 + Tailwind v4** integration
> specifics: component conventions, CSS framework wiring, breakpoint
> ladder, and the lint rules that enforce the integration. The
> top-level `product/strategy/_context.md` covers framework-agnostic
> architecture.

## Stack baseline

| Layer            | Choice                                  |
| ---------------- | --------------------------------------- |
| Design tool      | Pencil ([pencil.dev](https://pencil.dev)) — `.pen` files committed to repo |
| CSS              | Tailwind CSS v4 (CSS-variables theming) |
| Component lib    | HeroUI v3 (`@heroui/react@beta`, `@heroui/styles@beta`) |
| Variant authoring | `tailwind-variants` (tv()) for slot composition |
| Class merging    | `tailwind-merge` (twMerge) inside `cn()` helpers |
| ARIA primitives  | `react-aria-components` + `@react-aria/*` hooks |
| Icon set         | `lucide-react` (24px stroke 1.5 default), fallback `@gravity-ui/icons` |
| Font (default)   | `Inter` (sans), `JetBrains Mono` (mono) |

HeroUI v3 ships a 1:1 Figma kit with auto-layout and variables that map
directly to CSS tokens. **Always emit token references, not raw values**,
so the design file and the rendered code stay in lockstep.

## HeroUI v3 conventions to enforce in every prompt

### 1. Compound components

Components have a `.Root` and named slots (`Card.Root`, `Card.Header`,
`Card.Title`, `Card.Content`, `Card.Footer`). Pencil frames should
mirror this hierarchy and naming.

```tsx
<Card.Root>
  <Card.Header>
    <Card.Title>Active users</Card.Title>
    <Card.Description>Last 30 days</Card.Description>
  </Card.Header>
  <Card.Content>{/* ... */}</Card.Content>
  <Card.Footer>{/* ... */}</Card.Footer>
</Card.Root>
```

### 2. Semantic variants

Use `primary | secondary | tertiary | success | warning | danger`. Never
bake raw hex into a button or alert frame.

```tsx
<Button.Root variant="primary">Save</Button.Root>
<Alert.Root variant="danger">{/* ... */}</Alert.Root>
```

### 3. Component cascade — try in this order

When generating a component, work down this cascade:

1. **HeroUI v3** — `@heroui/react@beta` first. **Always try this first.**
2. **react-aria-components (RAC)** — when HeroUI doesn't ship the
   primitive. Wrap with `tailwind-variants` for styling.
3. **react-aria hooks** — `@react-aria/*` `use-*` hooks when RAC doesn't
   ship the composition you need. Build custom DOM + WAI-ARIA via the
   hook.
4. **Custom** — raw DOM + WAI-ARIA pattern guide. Last resort. Document
   why.

### 4. BEM class hint

Every component frame's `name` should match its BEM block (`.button`,
`.input-group`, `.alert-dialog`) so `sceneNodeToJsx` exports cleanly.

### 5. State coverage

Every component page must show: default, hover, focus, active, disabled,
loading (where applicable), and error (where applicable).

### 6. Theme coverage

When `supportsDark` and `supportsLight` are both true, render every page
twice on the same canvas: a Light section and a Dark section, side by
side, each on its respective surface.

## Tailwind v4 `@theme` integration

The framework-agnostic principle (token-driven styling) is implemented
in this stack via Tailwind v4's `@theme` block. Tokens declared in
`@theme` auto-generate utility classes:

```css
/* app/globals.css */
@theme {
  --color-accent-500: #0A84FF;
  --color-surface: #FFFFFF;
  --radius-card: 12px;
  --space-card-pad: 16px;
  --motion-duration-base: 200ms;
  --motion-ease-out: cubic-bezier(0, 0, 0.2, 1);
  /* ... */
}
```

Generates utilities like `bg-accent-500`, `bg-surface`, `rounded-card`,
`p-card-pad`, etc.

### The token-utility usage rule

Components reference tokens via the auto-generated utility classes:

```tsx
// ✅ Token-driven via Tailwind utility
<button className="bg-accent-500 rounded-card p-card-pad">

// ✅ Token-driven via inline style for dynamic values
<div style={{ color: 'var(--color-accent-700)' }}>

// ❌ Arbitrary value — fails the lint sweep
<button className="bg-[#0A84FF] rounded-[12px] p-[16px]">

// ❌ Hardcoded hex
<button style={{ background: '#0A84FF' }}>
```

### Arbitrary-value lint

The Phase 3 lint sweep in `heroui:build-components` runs this regex
against every component file:

```
(class(Name)?=|: ?")[^"]*\b(\w+-)\[[^\]]+\]
```

Hits indicate inline drift that bypasses the theme. The exemptions are
narrow:

- **Environment-driven sizing in test/story decorators**:
  `<div className="w-[360px]">` in a Storybook viewport wrapper
- **One-off layout primitives** where a token would create more drift
  than it prevents — uncommon, must be flagged in review

Anything else fails the build.

### Motion / z-index / i18n inline-value lints

Three additional lint patterns enforce the corresponding foundations:

- **Motion**: regex
  `transition[^;]*\b\d{2,4}m?s\b|transition-(?:all|colors|opacity|transform)\s+\b\d{2,4}` —
  flags inline durations like `transition: 200ms ease-out` or
  `transition-colors duration-200`. Use motion tokens:
  `var(--motion-duration-base)`, `var(--motion-transition-color)`.
- **Z-index**: regex
  `z-index\s*:\s*\d+|className=[^"]*\bz-\[?\d+\]?\b` —
  flags raw numeric z-index. Use z-index tokens: `z-modal`,
  `z-tooltip`, etc.
- **i18n direction**: regex
  `padding-(?:left|right)|margin-(?:left|right)|border-(?:left|right)|text-align\s*:\s*(?:left|right)` —
  flags physical-direction CSS properties. Use logical properties:
  `padding-inline-start`, `margin-inline-end`, `text-align: start | end`.

These run automatically during `heroui:build-components` Phase 3 and
during `audit` Plane 1.

## Tailwind v4 breakpoint ladder

The canonical breakpoint test widths (sit slightly inside the named
breakpoint so the narrowest case in the range is verified):

| Tailwind | Min   | Test width | Persona                              |
| -------- | ----- | ---------- | ------------------------------------ |
| base/xs  | 0     | 360        | small phone (iPhone SE / 13 mini)    |
| sm       | 640   | 640        | large phone landscape / phablet      |
| md       | 768   | 768        | tablet portrait                      |
| lg       | 1024  | 1024       | laptop / iPad landscape              |
| xl       | 1280  | 1280       | desktop                              |
| 2xl      | 1536  | 1440       | wide desktop (1440 matches templates)|

### Responsive coverage rule

Any component whose default render exceeds **400px in width** must
account for every Tailwind breakpoint within its scope, not just the
mobile narrow case.

**In the `.pen`** — render the component at every width where its
layout **meaningfully transitions**, not mechanically at every
breakpoint. If md through 2xl render identically, one frame covers
that range. Label each frame with the breakpoint range it represents
(`xs–sm`, `md`, `lg–2xl`). A `>400px` component with only a default
frame is incomplete and blocks downstream commands.

**In generated React code** — the implementation must use Tailwind
breakpoint utilities (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) or container
queries (`@container` + `@sm:` / `@md:`) to express **every transition
shown in the `.pen`**, and **only** those transitions. Two failure
modes both block the build:

- **Missing utility**: `.pen` shows a transition at md but the code has
  no `md:` prefix on the changed property → design-code drift.
- **Phantom utility**: code has `xl:` utilities but the `.pen` shows no
  transition at xl → developer added a non-designed responsive change.
  Either extend the design or remove the code.

### Component scope (which breakpoints apply)

Computed from where the component is used:

- Read the manifest's usage map. Union the breakpoint sets of every
  page the component appears on.
- Shared atoms with no page reference yet: full ladder (xs–2xl).
- Components inside a fixed-width container (e.g. a 480px sidebar
  panel) inherit the container's range, not the viewport's.

**Components ≤ 400px** are exempt by default. The rule re-engages for
any breakpoint where the design specifies a transition (rare for
atoms — usually only icon-only buttons that grow into labeled buttons
at md, or kbd hints that hide on touch viewports).

This breakpoint ladder coexists with the canonical 3-breakpoint
rendering for Pages / Templates / Large Organisms (defined in the
top-level `_context.md` rule). Both must be satisfied — a Pages
canvas with only desktop frames fails the canonical-3 rule even if
no build has run yet.

## Component implementation toolchain

Custom components in this repo (whether wrapping RAC or fully custom)
all use the same toolchain:

- `tailwind-variants` (tv()) for slot/variant composition
- `tailwind-merge` (twMerge) inside `cn()` helpers for class merging
- Tailwind v4 utilities for styling
- `@theme` design tokens (CSS custom properties) referenced via the
  auto-generated utility classes — never hex

Example:

```tsx
import { tv } from 'tailwind-variants';
import { cn } from '@/lib/utils';

const button = tv({
  base: 'inline-flex items-center justify-center rounded-button transition-colors-base focus-visible:outline-2 focus-visible:outline-accent-500',
  variants: {
    variant: {
      primary: 'bg-accent-500 text-on-accent hover:bg-accent-600',
      secondary: 'bg-surface-raised text-content-1 border border-separator',
      danger: 'bg-danger-500 text-on-danger hover:bg-danger-600',
    },
    size: {
      sm: 'h-8 px-3 text-body-sm',
      md: 'h-10 px-4 text-body-md',
      lg: 'h-12 px-6 text-body-lg',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});
```

For non-runtime references: **Tailwind UI templates** are copy-paste
inspiration, not a dep. If a layout pattern matches a Tailwind UI
template, acknowledge that in a comment but reimplement using the local
toolchain.
