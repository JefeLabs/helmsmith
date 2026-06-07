/**
 * HeroUI typography foundation — the `typography` DECISION page.
 *
 * Voice is a generation choice: `single` (one family for display + body) or a
 * complementary `set` (a distinct display face paired with the body face).
 * `CURATED_SETS` offers a few operator-grade pairings. The specimen page binds
 * each step to its family token (`$font.display`/`$font.family`/`$font.mono`)
 * and its size token (`$font.<step>.size`), so the foundation and components
 * reskin together.
 */

import type { TypeStep, TypographyFoundation } from '../../design-system/typography.ts';
import { familyToken } from '../../design-system/typography.ts';
import { frame, text } from '../../pen/builder.ts';
import type { Child } from '../../pen/schema.ts';
import type { FoundationSpec, MockupContext } from '../_core/adapter.ts';

/** The type scale, large → small. Sizes live in `tokens.ts` SCALARS. */
export const TYPE_STEPS: TypeStep[] = [
  { name: 'display-2xl', sizeKey: 'font.display-2xl.size', role: 'display', weight: '700', lineHeight: 1.13, sample: 'AgentX' },
  { name: 'display-xl', sizeKey: 'font.display-xl.size', role: 'display', weight: '700', lineHeight: 1.17, sample: 'Control plane' },
  { name: 'h1', sizeKey: 'font.h1.size', role: 'display', weight: '700', lineHeight: 1.22, sample: 'Run an agent job' },
  { name: 'h2', sizeKey: 'font.h2.size', role: 'display', weight: '600', lineHeight: 1.27, sample: 'Confirm & start' },
  { name: 'h3', sizeKey: 'font.h3.size', role: 'display', weight: '600', lineHeight: 1.33, sample: 'Acceptance criteria' },
  { name: 'h4', sizeKey: 'font.h4.size', role: 'display', weight: '600', lineHeight: 1.4, sample: 'Estimate' },
  { name: 'h5', sizeKey: 'font.h5.size', role: 'display', weight: '600', lineHeight: 1.38, sample: 'Current step' },
  { name: 'body-lg', sizeKey: 'font.body-lg.size', role: 'body', weight: '400', lineHeight: 1.5, sample: 'The coordinator paraphrases your intent before the job runs.' },
  { name: 'body-md', sizeKey: 'font.body-md.size', role: 'body', weight: '400', lineHeight: 1.43, sample: 'Default UI text — dense operator console at 14px.' },
  { name: 'body-sm', sizeKey: 'font.body-sm.size', role: 'body', weight: '400', lineHeight: 1.38, sample: 'Secondary metadata and helper text.' },
  { name: 'caption', sizeKey: 'font.caption.size', role: 'body', weight: '500', lineHeight: 1.33, sample: 'STORY POINTS · EST. BY FLOW' },
  { name: 'code-md', sizeKey: 'font.code-md.size', role: 'mono', weight: '450', lineHeight: 1.46, sample: 'job_a1b2c3d4 · loadContext.ts (+12 -3)' },
  { name: 'code-sm', sizeKey: 'font.code-sm.size', role: 'mono', weight: '450', lineHeight: 1.42, sample: 'sha256:9f3a… · 14:02:11 planner routed' },
];

export interface FontSet {
  id: string;
  /** Headings face. */
  display: string;
  /** Body / UI face. */
  body: string;
  /** Code face. */
  mono: string;
  /** Why these complement each other. */
  note: string;
}

/**
 * Complementary pairings for `set` voice (display ≠ body), sourced from
 * https://fontpair.co/all. Mono defaults to JetBrains Mono unless the pairing
 * implies its own (Archivo → IBM Plex Mono). All are Google Fonts.
 */
export const CURATED_SETS: FontSet[] = [
  { id: 'unbounded-albert', display: 'Unbounded', body: 'Albert Sans', mono: 'JetBrains Mono', note: 'Bold geometric display over a clean grotesque body — fontpair.co.' },
  { id: 'urbanist-opensans', display: 'Urbanist', body: 'Open Sans', mono: 'JetBrains Mono', note: 'Geometric display + humanist body — fontpair.co.' },
  { id: 'worksans-bitter', display: 'Work Sans', body: 'Bitter', mono: 'JetBrains Mono', note: 'Grotesk headings + slab-serif body, editorial — fontpair.co.' },
  { id: 'archivo-inter', display: 'Archivo', body: 'Inter', mono: 'IBM Plex Mono', note: 'Condensed-grotesk headings; IBM Plex Mono for code — fontpair.co.' },
];

export interface TypographyOptions {
  mode?: 'single' | 'set';
  /** Pick a curated `CURATED_SETS` pairing by id (implies `mode: "set"`). */
  set?: string;
  /** Body / UI family (single voice uses this for headings too). */
  body?: string;
  /** Display family (set voice). */
  display?: string;
  /** Mono family. */
  mono?: string;
}

/** Resolve a typography decision into a foundation (default: single Inter). */
export function heroUITypography(opts: TypographyOptions = {}): TypographyFoundation {
  const chosen = opts.set ? CURATED_SETS.find((s) => s.id === opts.set) : undefined;
  const mode = chosen ? 'set' : (opts.mode ?? 'single');
  const bodyFamily = opts.body ?? chosen?.body ?? 'Inter';
  const displayFamily =
    mode === 'single' ? bodyFamily : (opts.display ?? chosen?.display ?? CURATED_SETS[0].display);
  const monoFamily = opts.mono ?? chosen?.mono ?? 'JetBrains Mono';
  return { mode, displayFamily, bodyFamily, monoFamily, steps: TYPE_STEPS };
}

function buildTypographyPage(ctx: MockupContext, tf: TypographyFoundation): Child[] {
  let seq = 0;
  const nid = (p: string) => `ft-${p}-${seq++}`;
  const fg = ctx.token('color.foreground');
  const muted = ctx.token('color.muted');
  const metaFam = ctx.token('font.mono');

  const voice =
    tf.mode === 'single'
      ? `single voice · ${tf.bodyFamily}`
      : `set · ${tf.displayFamily} + ${tf.bodyFamily}`;

  const header = frame('ft-header', { name: 'Header', layout: 'vertical', gap: 4 }, [
    text('ft-title', 'Typography', { fill: fg, fontFamily: ctx.token('font.display'), fontSize: 28, fontWeight: '700' }),
    text('ft-sub', `${voice} · mono ${tf.monoFamily} · ${tf.steps.length} steps`, {
      fill: muted,
      fontFamily: metaFam,
      fontSize: 14,
    }),
  ]);

  const rows = tf.steps.map((s) =>
    frame(nid('step'), { name: s.name, layout: 'vertical', gap: 3 }, [
      text(nid('specimen'), s.sample, {
        fill: fg,
        fontFamily: ctx.token(familyToken(s.role)),
        fontSize: ctx.token(s.sizeKey),
        fontWeight: s.weight,
        lineHeight: s.lineHeight,
      }),
      text(nid('meta'), `${s.name} · ${s.weight} · lh ${s.lineHeight} · ${s.role}`, {
        fill: muted,
        fontFamily: metaFam,
        fontSize: 11,
      }),
    ]),
  );

  return [
    frame(
      'foundation-typography',
      {
        name: 'Foundations / Typography',
        width: 920,
        fill: ctx.token('color.background'),
        theme: { mode: 'light' },
        layout: 'vertical',
        gap: 24,
        padding: 40,
      },
      [header, frame('ft-scale', { name: 'Scale', layout: 'vertical', gap: 20 }, rows)],
    ),
  ];
}

export function typographyFoundation(opts: TypographyOptions = {}): FoundationSpec {
  const tf = heroUITypography(opts);
  return {
    slug: 'typography',
    name: 'Foundations / Typography',
    build: (ctx) => buildTypographyPage(ctx, tf),
  };
}
