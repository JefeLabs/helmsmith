---
description: Generate the Media component page — image gallery, video player, carousel, lightbox. Each wraps a focused library (lightbox for image overlays, framer-motion for carousels) rather than building from scratch.
allowed-tools: Read, Write, Edit, Bash, mcp__pencil__*
---

Generate `design/components/media.pen` — the Media component group
covering image, video, and carousel patterns. Each component is a
**styled wrapper around a focused library**, not a from-scratch build.

## Pre-flight

1. Read `product/strategy/_context.md` and `frameworks/heroui/_context.md`.
2. Read `product/.pencil-brand.json` for `imagery.direction` — gallery
   layouts and lightbox treatment respect the recorded direction.
3. If MCP: `get_guidelines({ category: "guide", name: "Media" })`.

## Embedded prompt

> Build a Pencil page named **`Components / Media`** for **{{brand}}**.
> Use HeroUI v3 chrome (Card, Modal, IconButton).
>
> ### Image (Image.Root)
>
> A wrapper around `next/image` (Next.js) or a CDN-aware `<img>`
> (other frameworks). Render four variants:
> - **Default**: standard image with rounded corners
>   (`--radius-md`), object-fit cover, lazy loading
> - **Bordered**: 1px `--color-separator` border (used in
>   testimonials, profile cards)
> - **Overlay caption**: image with bottom-aligned overlay
>   (gradient + caption text)
> - **Aspect-ratio enforced**: explicit aspect ratio (16:9, 4:3,
>   1:1, 3:4, 21:9) with proper letterboxing if source doesn't
>   match
>
> Each at 320×240 with placeholder content (diagonal-line gray-box).
> Annotate with the underlying tag and important props
> (`loading="lazy"`, `decoding="async"`, alt-text guidance).
>
> ### Image gallery (Gallery.Root → Item)
>
> Render three gallery layouts:
>
> 1. **Grid** — N images in equal-sized cells (3-col, 4-col, 5-col
>    options). Uniform aspect ratio.
> 2. **Masonry** — variable-height columns, images flow in
>    Pinterest-style. Best for varied aspect ratios.
> 3. **Justified rows** — variable-width cells in fixed-height rows
>    (Flickr-style). Each row's images scale to fill the row width.
>
> Each rendered with 9 placeholder images. Show:
> - Hover state: subtle scale (1.02) and `--motion-transition-slide`
>   timing from the motion foundation
> - Click → opens lightbox (next variant)
> - Keyboard nav: arrow keys move focus, Enter opens lightbox
>
> ### Lightbox (Lightbox.Root → Backdrop → Content → Caption)
>
> A modal-overlay pattern for full-size image viewing:
> - Full-screen `--color-backdrop` overlay
> - Centered image, max 90% viewport (W and H)
> - Caption row below image: title + alt-text/description
> - Top-right close "×"
> - Bottom-center thumbnail strip for navigation between images
> - Keyboard: arrow keys for prev/next, Esc to close
> - Pinch-zoom on touch devices
>
> Render two states:
> - Default lightbox open with one image
> - Lightbox with thumbnail strip showing 5 thumbnails (current
>   highlighted)
>
> Library wrapper: yet-another-react-lightbox or photoswipe — both
> support the keyboard/touch behaviors above.
>
> ### Video player (Video.Root → Controls → Caption)
>
> A wrapper providing brand styling over native `<video>`:
> - **Native controls** variant: uses browser's native player
>   (sufficient for most use cases)
> - **Custom controls** variant: themed play/pause, scrubber,
>   volume, fullscreen, captions toggle. Built with HeroUI atoms
>   (IconButton, Slider) on top of `<video>`.
>
> Render both variants at 640×360. Show:
> - Poster frame (placeholder rectangle with diagonal line + play
>   icon overlay)
> - Loading state (skeleton)
> - Error state (cannot-load message + retry)
> - Captions / subtitles support (annotated; the actual rendering
>   is browser-native via `<track>` element)
>
> Library wrapper for advanced cases: video.js or plyr (only when
> brand needs custom controls AND streaming protocol support).
>
> ### Carousel (Carousel.Root → Slide + Indicators + Controls)
>
> Render three carousel variants:
>
> 1. **Image carousel** — full-width slides showing images,
>    auto-play optional with pause-on-hover, keyboard nav
> 2. **Card carousel** — multiple cards per viewport, scrollable
>    horizontally (e.g. testimonials, related-articles)
> 3. **Hero rotator** — auto-cycling hero variants (5–10s per
>    slide), prominent indicators, used in marketing landings
>
> Each at full canvas width. Show:
> - Indicators (dot row): current slide highlighted, click jumps
> - Prev/next chevrons (visible on hover for desktop, always
>   visible on touch)
> - Touch swipe gesture supported
> - Auto-play respects `prefers-reduced-motion` (disabled by
>   default if reduced-motion is set)
> - Pause-on-hover for desktop, pause-on-focus for keyboard users
>
> Library: embla-carousel — tiny, accessible, framework-agnostic.
> Don't use `react-slick` (jQuery legacy) or `swiper` (heavy).
>
> ### Section 6 — Image-loading strategy reference
>
> A reference card describing image-loading conventions:
> - **Above-the-fold images**: `loading="eager"`, `priority` if
>   Next.js
> - **Below-the-fold images**: `loading="lazy"` (browser default
>   when not specified)
> - **LCP image** (Largest Contentful Paint, usually the hero):
>   explicit `priority` prop in `next/image`, preload `<link>` in
>   `<head>`
> - **Source set**: provide responsive variants
>   (`srcset="image-400.jpg 400w, image-800.jpg 800w"`) so browsers
>   pick appropriate resolution
> - **Blur placeholder** (for Next.js): `placeholder="blur"` with
>   `blurDataURL` for smooth-loading hero images
>
> ### Section 7 — Accessibility for media
>
> Reference card:
> - **Images**: meaningful `alt` text (or `alt=""` for purely
>   decorative). Never auto-generate from filename.
> - **Videos**: captions track for accessibility, audio
>   description if visual-only content is critical
> - **Carousels**: pause/play affordance, indicators have aria-current,
>   slide content is in document order (not just position-shifted)
> - **Galleries**: keyboard navigation, focus visible on cells, alt
>   on every image
> - **Lightbox**: focus trap, return-focus on close, Esc dismisses,
>   announce slide context for screen readers
>
> ### Section 8 — Performance budget reference
>
> Reference card with performance guidelines:
> - **Hero images**: ≤ 200 KB compressed, WebP or AVIF
> - **Gallery images**: ≤ 80 KB per thumbnail, larger for lightbox
>   on demand
> - **Video posters**: ≤ 80 KB; video itself streamed not
>   embedded
> - **Carousels**: lazy-load slides 2+ until they're about to
>   appear
>
> ### Naming
> - Component frames: `image-{{variant}}`, `gallery-{{layout}}`,
>   `lightbox-{{state}}`, `video-{{controls-mode}}`,
>   `carousel-{{variant}}`
> - Reference frames: `loading-strategy`, `media-a11y`,
>   `performance-budget`

## Execution

```bash
pencil --out design/components/media.pen \
       --model claude-sonnet-4-7 \
       --prompt "$(cat <<'PROMPT'
{{interpolated prompt above}}
PROMPT
)"
```

## Verify

Screenshot the page. Confirm:
- 4 image variants
- 3 gallery layouts with 9 placeholders each
- Lightbox in 2 states
- Video player in both control modes
- 3 carousel variants
- Loading-strategy / a11y / performance-budget references

## Component contract

Media components are **library wrappers**, not from-scratch builds:

| Component | Underlying library             |
| --------- | ------------------------------ |
| Image     | next/image (or framework eq.)  |
| Gallery   | Custom (CSS Grid + masonry-css for masonry layout) |
| Lightbox  | yet-another-react-lightbox     |
| Video     | Native `<video>` + custom controls if needed |
| Carousel  | embla-carousel-react           |

The component code wraps these with brand styling, theme tokens,
and the patterns from `patterns/states.pen` for empty / loading /
error states. Don't reimplement these from primitives — the
libraries handle edge cases (touch, accessibility, browser bugs)
that take months to get right.

`build-components` recognizes media components as library-wrapper
patterns and skips the WAI-ARIA cascade level (since the library
provides the ARIA semantics). The lint checks still apply: theme
tokens only, no arbitrary values.
