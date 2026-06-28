/**
 * `color-mix(in oklab, …)` — the operation HeroUI v3 uses to derive
 * every hover / soft / secondary-surface / border token from a small
 * set of base colors. We resolve it once, here, at generation time so
 * the emitted `.pen` carries concrete static values.
 *
 * Why this is YOUR call and not boilerplate
 * -----------------------------------------
 * The CSS spec leaves two genuine modeling decisions, and they change
 * how the whole generated palette looks:
 *
 *   1. Weighting. HeroUI writes `color-mix(in oklab, A 90%, B 10%)`.
 *      With both percentages given, the result is the normalized
 *      weighted average of A and B in OKLab. (If they don't sum to
 *      100, CSS normalizes them; you can decide whether to honor that
 *      or require pre-normalized inputs.)
 *
 *   2. Transparency. HeroUI builds "soft" variants as
 *      `color-mix(in oklab, A 15%, transparent)`. Per the CSS spec,
 *      mixing with `transparent` does NOT wash the hue toward black —
 *      `transparent` contributes 0 alpha and its *color* is premultiplied
 *      out, so the result is "A at alpha 0.15". Decide whether you
 *      premultiply alpha before interpolating (spec-correct, keeps the
 *      hue pure) or interpolate straight (simpler, slightly muddier
 *      soft colors). This choice is visible on every soft chip/badge.
 *
 * Trade-offs to weigh
 *   - Premultiplied alpha = matches browsers exactly; a few more lines.
 *   - Straight alpha = fewer lines; soft tokens drift slightly when the
 *     base color is dark.
 *   - Clamp/normalize weights defensively vs. trust the adapter.
 *
 * Contract (do not change the signature — `derive.ts` depends on it):
 *
 *   mixOklab(a, b, weightA)
 *     a, b      : Lab (already parsed; alpha is straight 0..1)
 *     weightA   : 0..1 — the share of `a` (so HeroUI's `A 90%, B 10%`
 *                 is `mixOklab(A, B, 0.9)`)
 *     returns   : Lab — the mixed color, straight alpha
 *
 * `derive.ts` catches a thrown error here and degrades gracefully
 * (emits base tokens only, with a warning) so the rest of the CLI
 * keeps working until this is implemented.
 */

import type { Lab } from './oklch.ts';

export class ColorMixNotImplemented extends Error {
  constructor() {
    super(
      'mech-pencil: mixOklab() is not implemented yet — implement it in ' +
        'src/color/mix.ts to enable derived (hover/soft/border) tokens.',
    );
    this.name = 'ColorMixNotImplemented';
  }
}

/**
 * Premultiplied-alpha mix in OKLab — matches CSS `color-mix(in oklab,
 * a wA%, b (1-wA)%)`. Premultiplied so mixing toward `transparent`
 * (HeroUI's `*-soft` recipe) yields a clean translucent tint of `a`
 * rather than a desaturated patch. For opaque operands (the `*-hover`
 * recipes) this is identical to a straight weighted mean.
 *
 * HeroUI's recipe weights always sum to 1, so the CSS "renormalize +
 * alpha-scale when the percentages sum to <100%" rule is intentionally
 * not modelled; the `clamp` is just defensive insurance.
 */
export function mixOklab(a: Lab, b: Lab, weightA: number): Lab {
  const wA = Math.min(1, Math.max(0, weightA));
  const wB = 1 - wA;
  const alpha = a.alpha * wA + b.alpha * wB;
  if (alpha === 0) return { L: 0, a: 0, b: 0, alpha: 0 };
  const un = (ca: number, cb: number) =>
    (ca * a.alpha * wA + cb * b.alpha * wB) / alpha;
  return {
    L: un(a.L, b.L),
    a: un(a.a, b.a),
    b: un(a.b, b.b),
    alpha,
  };
}
