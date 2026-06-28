/**
 * Project brand input — the JSON `mech-pencil brand <file>` ingests.
 *
 * Shape is exactly what a brand team already produces: named color
 * ramps (50…950), semantic status colors, and optional font/size
 * blocks. mech-pencil maps this onto a variables-only `brand.pen`
 * (raw ramps + a semantic layer) that the generated `design.pen`
 * imports — swap/regenerate `brand.pen` per project to reskin.
 */

/** A color ramp: step → hex (e.g. `{ "50": "#eef1f8", … "950": "#0a142a" }`). */
export type Ramp = Record<string, string>;

export interface BrandFile {
  /** Named ramps. `accent` & `neutral` drive the semantic layer. */
  colorRamps?: Record<string, Ramp>;
  /** Semantic status colors (success/warning/danger/info, …). */
  statusColors?: Record<string, string>;
  /** Typography. `family` becomes `font.family`. */
  fonts?: { family?: string } & Record<string, string>;
  /** Numeric tokens; keys override the scalar defaults by name. */
  sizes?: Record<string, number>;
}

/** Minimal structural check (throws on the few things that break mapping). */
export function assertBrandFile(value: unknown): asserts value is BrandFile {
  if (!value || typeof value !== 'object') {
    throw new Error('brand file must be a JSON object');
  }
  const b = value as Record<string, unknown>;
  for (const key of ['colorRamps', 'statusColors', 'fonts', 'sizes'] as const) {
    if (b[key] !== undefined && (typeof b[key] !== 'object' || b[key] === null)) {
      throw new Error(`brand.${key} must be an object when present`);
    }
  }
  if (!b.colorRamps && !b.statusColors) {
    throw new Error('brand file needs at least `colorRamps` or `statusColors`');
  }
}
