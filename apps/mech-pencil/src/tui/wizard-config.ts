/**
 * Pure (React-free) logic for the no-args wizard. Kept out of
 * `WizardView.tsx` so it's unit-testable in isolation (CONVENTIONS.md:
 * co-located `*.test.ts`, behavior-named).
 *
 * The wizard flow: pick framework → fill the 5 HeroUI theme knobs →
 * review → emit the layered bundle (`runBundle`). This module owns the
 * field model, enum cycling, the draft→ThemeConfig finalize, and the
 * draft→BundleCmdOptions mapping. The single open decision —
 * `validateField` — is delegated (see TODO below).
 */

import type { BundleCmdOptions } from '../commands/bundle.ts';
import {
  DEFAULT_THEME,
  RADIUS_IDS,
  type RadiusId,
  resolveTheme,
  type ThemeConfig,
} from '../theme/config.ts';

/** Fonts the HeroUI theme generator round-trips (see theme/config.ts). */
export const FONT_OPTIONS = ['Inter', 'Instrument Sans', 'Geist', 'Satoshi'] as const;

export type ThemeFieldId = 'accent' | 'base' | 'fontFamily' | 'radius' | 'formRadius';

export interface ThemeField {
  id: ThemeFieldId;
  label: string;
  /** `text` → typed via <Input>; `enum` → cycled with ←/→. */
  kind: 'text' | 'enum';
  /** Allowed values for `enum` fields. */
  options?: readonly string[];
  hint: string;
}

export const THEME_FIELDS: readonly ThemeField[] = [
  { id: 'accent', label: 'Accent color', kind: 'text', hint: 'hex #rrggbb or oklch(L C H)' },
  { id: 'base', label: 'Neutral base', kind: 'text', hint: 'gray-tint, 0–0.02' },
  {
    id: 'fontFamily',
    label: 'Font family',
    kind: 'enum',
    options: FONT_OPTIONS,
    hint: '←/→ to cycle',
  },
  { id: 'radius', label: 'Corner radius', kind: 'enum', options: RADIUS_IDS, hint: '←/→ to cycle' },
  {
    id: 'formRadius',
    label: 'Form-field radius',
    kind: 'enum',
    options: RADIUS_IDS,
    hint: '←/→ to cycle',
  },
];

/** Working draft while the user edits (all strings; finalized at the end). */
export interface ThemeDraft {
  accent: string;
  base: string;
  fontFamily: string;
  radius: RadiusId;
  formRadius: RadiusId;
}

export function initialDraft(): ThemeDraft {
  return {
    accent: DEFAULT_THEME.accent,
    base: String(DEFAULT_THEME.base),
    fontFamily: DEFAULT_THEME.fontFamily,
    radius: DEFAULT_THEME.radius,
    formRadius: DEFAULT_THEME.formRadius,
  };
}

export function getField(draft: ThemeDraft, id: ThemeFieldId): string {
  return draft[id];
}

export function setField(draft: ThemeDraft, id: ThemeFieldId, value: string): ThemeDraft {
  return { ...draft, [id]: value };
}

/** Step one position forward/back through an enum field's options (wraps). */
export function cycle(options: readonly string[], current: string, dir: 1 | -1): string {
  if (options.length === 0) return current;
  const i = Math.max(0, options.indexOf(current));
  return options[(i + dir + options.length) % options.length] as string;
}

/** Draft → validated ThemeConfig (throws on invalid base/radius via resolveTheme). */
export function finalizeTheme(draft: ThemeDraft): ThemeConfig {
  return resolveTheme({
    accent: draft.accent,
    base: Number(draft.base),
    fontFamily: draft.fontFamily,
    radius: draft.radius,
    formRadius: draft.formRadius,
  });
}

export interface WizardResult {
  frameworkId: string;
  draft: ThemeDraft;
}

/**
 * Map the wizard result onto `runBundle`'s options. `frameworkId` is
 * carried for messaging only — `emitBundle` currently emits HeroUI's
 * token contract (shared by heroui & heroui-pro), so it isn't a
 * BundleCmdOptions field. When token contracts diverge per framework,
 * thread it through here.
 */
export function themeToBundleOptions(_frameworkId: string, cfg: ThemeConfig): BundleCmdOptions {
  return {
    accent: cfg.accent,
    base: String(cfg.base),
    font: cfg.fontFamily,
    radius: cfg.radius,
    formRadius: cfg.formRadius,
    dir: '.',
  };
}

/**
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ YOUR CONTRIBUTION — validateField()                              │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Gates advancement out of an edited text field in the wizard. Return
 * `null` to accept the value, or a SHORT inline error string to show
 * the user and block them until they fix it.
 *
 * Only the two `kind: 'text'` fields reach this (enum fields can't be
 * invalid — they're cycled through fixed options):
 *
 *   • 'accent'  raw color the user typed. A real parser exists:
 *               `parseColor(input)` from `../color/oklch.ts` accepts
 *               hex / oklch() and THROWS on anything it can't parse.
 *   • 'base'    HeroUI neutral gray-tint. `resolveTheme` already
 *               rejects NaN / <0; the *documented* useful range is
 *               0–0.02 (see theme/config.ts).
 *
 * This is a genuine UX-vs-strictness trade-off, which is why it's
 * yours to decide:
 *   - Delegate accent to `parseColor` (catch → message): strictest,
 *     catches typos immediately, but rejects valid CSS colors the
 *     port doesn't implement.
 *   - Permissive regex / accept-blank-as-default: fewer false
 *     rejections, but bad input only surfaces later at emit time.
 *   - For 'base': hard-reject outside 0–0.02, or accept-and-warn?
 *
 * ~5–10 lines. The wizard is already fully functional with the
 * permissive placeholder below; your job is to tighten it.
 *
 * TODO(you): replace the placeholder with your validation policy.
 */
export function validateField(id: ThemeFieldId, value: string): string | null {
  // Placeholder: accept everything. Replace with your policy for
  // 'accent' and 'base'. (Import `parseColor` from '../color/oklch.ts'
  // if you choose to delegate accent parsing.)
  void id;
  void value;
  return null;
}
