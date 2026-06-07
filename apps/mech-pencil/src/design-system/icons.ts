/**
 * Framework-agnostic icon foundation model.
 *
 * A `FrameworkAdapter.foundations()` emits an icon DECISION page from an
 * `IconFoundation`: the size scale (scalar token keys, so the page and any
 * component consume the same `$icon.*` tokens) plus a semantic role → glyph
 * map. Glyph names are the adapter's icon-font names (e.g. lucide), rendered
 * via `icon_font` nodes — keeping the foundation themeable + token-bound, the
 * same contract as colors/typography.
 */

/** One semantic mapping: a UI role bound to a concrete icon-font glyph. */
export interface IconEntry {
  /** Semantic role, e.g. `"add"`, `"delete"`, `"success"`. */
  role: string;
  /** Icon-font glyph name (matches the adapter's `iconFontFamily`). */
  icon: string;
  /** Optional grouping for the foundation page, e.g. `"Actions"`. */
  group?: string;
}

export interface IconFoundation {
  /** Icon-font family the glyphs come from (e.g. `"lucide"`). */
  family: string;
  /**
   * Scalar token keys for the size scale, small → large
   * (e.g. `["icon.xs", "icon.sm", … "icon.2xl"]`). Each must exist in the
   * adapter's `TokenSet.scalars` so `$icon.*` resolves.
   */
  sizeKeys: string[];
  /** Semantic role → glyph map. */
  semantic: IconEntry[];
}
