/**
 * Map a `BrandFile` → the `brand.pen` variable set.
 *
 * Three layers, all in one variables-only document:
 *   1. raw ramps      `accent.500`, `neutral.50`, …            (color)
 *   2. status colors   `status.success`, …                     (color)
 *   3. semantic layer  `color.accent`, `color.muted`, …        (color)
 *      + scalars       `radius.md`, `space.unit`, `font.*`      (number/string)
 *
 * The semantic keys are exactly the ones every component already
 * binds to (`ctx.color('accent')` → `$brand:color.accent`), so no
 * component changes are needed. Semantic colors are resolved to
 * CONCRETE hex from the ramps at generation time — this sidesteps the
 * one untested cross-file link (a variable whose value is itself an
 * imported variable). Swapping `brand.pen` per project still reskins
 * because each project's `brand.pen` carries its own concrete values.
 */

import type { VariableDecl } from '../pen/schema.ts';
import type { BrandFile, Ramp } from './schema.ts';

/** Semantic color name → [ramp, step, fallback hex]. */
const SEMANTIC: Record<string, [string, string, string]> = {
  accent: ['accent', '500', '#3f5694'],
  'accent-foreground': ['', '', '#ffffff'],
  'accent-soft': ['accent', '100', '#dde3f1'],
  background: ['neutral', '50', '#f6f7f9'],
  foreground: ['neutral', '900', '#1c2129'],
  surface: ['', '', '#ffffff'],
  'surface-foreground': ['neutral', '900', '#1c2129'],
  muted: ['neutral', '500', '#6b7385'],
  border: ['neutral', '200', '#d9dce3'],
  'field-background': ['', '', '#ffffff'],
  'field-placeholder': ['neutral', '400', '#8b93a3'],
  success: ['success', '500', '#2f9e6e'],
  warning: ['warning', '500', '#c98a2e'],
  danger: ['danger', '500', '#c2453f'],
  info: ['info', '500', '#3a72b8'],
};

const SCALAR_DEFAULTS: Record<string, number> = {
  'radius.sm': 4,
  'radius.md': 8,
  'radius.lg': 12,
  'space.unit': 8,
  'border.width': 1,
  'font.size-sm': 14,
  'font.size-md': 16,
  'font.size-lg': 20,
};

function pick(ramps: Record<string, Ramp> | undefined, ramp: string, step: string, fallback: string): string {
  return (ramp && ramps?.[ramp]?.[step]) || fallback;
}

export interface BrandTokens {
  /** Ordered variable map for `brand.pen`. */
  variables: Record<string, VariableDecl>;
  /** Stats for the CLI summary. */
  counts: { ramps: number; status: number; semantic: number; scalars: number };
}

/** A scalar token from the framework adapter (the single source for the scale). */
export type AdapterScalar = { key: string; type: 'number' | 'string'; value: number | string };

export function brandToTokens(brand: BrandFile, adapterScalars?: AdapterScalar[]): BrandTokens {
  const variables: Record<string, VariableDecl> = {};

  // 3. semantic layer first (easy to find; what components reference)
  let semantic = 0;
  for (const [name, [ramp, step, fallback]] of Object.entries(SEMANTIC)) {
    // status semantics prefer an explicit statusColors entry.
    const status = brand.statusColors?.[name];
    variables[`color.${name}`] = {
      type: 'color',
      value: status ?? pick(brand.colorRamps, ramp, step, fallback),
    };
    semantic++;
  }

  // 1. raw ramps
  let rampCount = 0;
  for (const [rampName, ramp] of Object.entries(brand.colorRamps ?? {})) {
    for (const [step, hex] of Object.entries(ramp)) {
      variables[`${rampName}.${step}`] = { type: 'color', value: hex };
      rampCount++;
    }
  }

  // 2. status colors
  let status = 0;
  for (const [name, hex] of Object.entries(brand.statusColors ?? {})) {
    variables[`status.${name}`] = { type: 'color', value: hex };
    status++;
  }

  // scalars — prefer the adapter's full set (covers the foundation tokens:
  // icon.*, font.<step>.size, space.*, grid.*); else the legacy defaults.
  // brand.sizes overrides numerics by key.
  let scalars = 0;
  if (adapterScalars) {
    for (const s of adapterScalars) {
      variables[s.key] =
        s.type === 'number'
          ? { type: 'number', value: brand.sizes?.[s.key] ?? (s.value as number) }
          : { type: 'string', value: s.value as string };
      scalars++;
    }
  } else {
    for (const [key, def] of Object.entries(SCALAR_DEFAULTS)) {
      variables[key] = { type: 'number', value: brand.sizes?.[key] ?? def };
      scalars++;
    }
  }
  for (const [key, n] of Object.entries(brand.sizes ?? {})) {
    if (!(key in variables)) {
      variables[key] = { type: 'number', value: n };
      scalars++;
    }
  }
  // font faces — brand.fonts overrides; single voice keeps display = body.
  const fam = brand.fonts?.family;
  if (adapterScalars) {
    if (fam) {
      variables['font.family'] = { type: 'string', value: fam };
      variables['font.display'] = { type: 'string', value: brand.fonts?.display ?? fam };
    }
    if (brand.fonts?.mono) variables['font.mono'] = { type: 'string', value: brand.fonts.mono };
  } else {
    variables['font.family'] = { type: 'string', value: fam ?? 'Inter' };
    scalars++;
  }

  return {
    variables,
    counts: { ramps: rampCount, status, semantic, scalars },
  };
}
