/**
 * Button — YOUR second contribution point.
 *
 * Button is the most-instantiated component in any design system, so
 * how you model it shapes every mockup built on this library. The
 * decision is genuinely yours because there are several valid shapes
 * and HeroUI's matrix is large:
 *
 *   variants : solid | bordered | light | flat | ghost | faded
 *   colors   : default | accent | success | warning | danger
 *   sizes    : sm | md | lg
 *   states   : default | hover | disabled
 *
 * You can't put all of that in one node. Pick a strategy:
 *
 *   A. One base "button" component (solid/accent/md) + the catalog
 *      emits sibling preset components (e.g. "button-bordered",
 *      "button-danger") as `ref`s that override fill/stroke via
 *      `descendants["button/label"]`. Few definitions, many presets.
 *
 *   B. One "button" component per variant×color (≈30 reusable nodes).
 *      Most faithful, biggest library, most duplication.
 *
 *   C. One base component, variants expressed through the `mode` theme
 *      axis or instance overrides only. Leanest, least discoverable.
 *
 * Each is defensible — A balances fidelity and size, B maximizes
 * design-tool ergonomics, C minimizes the file. Your domain call.
 *
 * Model it on `card.ts`. The minimum this function must return is the
 * base Button as ONE reusable node:
 *
 *   - a horizontal `frame` (id `"button"`), auto-size to content
 *   - `--radius-md`, `--accent` fill, `--accent-foreground` label
 *   - vertical padding ~10, horizontal ~16, gap = space.unit
 *   - a centered `text` child id `"button/label"` ("Button")
 *   - `reusable(...)` + `withMeta(..., { type:'component',
 *     framework:'heroui', atomic:'atom', fidelity:'full' })`
 *
 * Reference the BuildContext helpers (`ctx.color('accent')`,
 * `ctx.token('radius.md')`) — never hardcode. ~8–12 lines.
 *
 * Until you implement it, the catalog catches `ButtonSpecNotImplemented`
 * and falls back to the generic stub, so the CLI keeps working.
 */

import type { BuildContext } from '../../../design-system/atomic.ts';
import { frame, reusable, text, withMeta } from '../../../pen/builder.ts';
import type { Child } from '../../../pen/schema.ts';
import { faIconNode } from '../fa-icons.ts';

export class ButtonSpecNotImplemented extends Error {
  constructor() {
    super(
      'mech-pencil: buildButton() is a stub — author it in ' +
        'src/frameworks/heroui/components/button.ts for a faithful Button.',
    );
    this.name = 'ButtonSpecNotImplemented';
  }
}

/**
 * Strategy A — the base Button only (solid / accent / md). Variant and
 * color presets (button-danger, button-hover, …) are intended as their
 * own catalog entries that `ref` this base + override via descendants,
 * keeping each preset cheap and this definition the single source of
 * the button's structure. Mirrors `card.ts`.
 */
export function buildButton(ctx: BuildContext): Child {
  // Leading glyph — an FA path icon sized by the ICON foundation (`$icon.sm`).
  const glyph = faIconNode('button-icon', 'plus', ctx.token('icon.sm'), ctx.color('accent-foreground'));
  // Label — consumes the TYPOGRAPHY foundation (`$font.body-md.size`).
  const label = text('button-label', 'Button', {
    fill: ctx.color('accent-foreground'),
    fontFamily: ctx.token('font.family'),
    fontSize: ctx.token('font.body-md.size'),
    fontWeight: '600',
  });

  return withMeta(
    reusable(
      frame(
        'button',
        {
          name: 'Button',
          height: 40,
          fill: ctx.color('accent'),
          cornerRadius: ctx.token('radius.md'),
          layout: 'horizontal',
          // gap + padding consume the SPACING foundation (`$space.*`).
          gap: ctx.token('space.2'),
          padding: [ctx.token('space.3'), ctx.token('space.4')],
          justifyContent: 'center',
          alignItems: 'center',
        },
        [glyph, label],
      ),
    ),
    { type: 'component', framework: 'heroui', atomic: 'atom', fidelity: 'full' },
  );
}

export type { Child };
