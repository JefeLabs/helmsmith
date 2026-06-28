/**
 * Base16 / Tinted Theming compatibility AND richer theme-file loading.
 *
 * Three on-disk shapes are recognized:
 *
 *   1. Flat base16 record (the standard scheme format):
 *        scheme: "Tokyo Night"
 *        base00: "1a1b26"
 *        … base01..base0F …
 *
 *   2. Rich ThemeDefinition (palette + optional overrides):
 *        name: "tokyo-night"
 *        displayName: "Tokyo Night"
 *        appearance: dark
 *        palette: { base00: "...", … }
 *        overrides:
 *          colors: { primary: "..." }
 *
 *   3. Partial Theme override (no palette, used for app-specific tweaks):
 *        colors:
 *          primary: "#ff79c6"
 *        components:
 *          button: { sizes: { md: { paddingX: 3 } } }
 *
 * `loadThemeFile()` handles (1) and (2) → returns a Theme.
 * `loadOverrideFile()` handles (3) → returns a Partial<Theme>.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { defineTheme } from './tokens.ts';
import type { Base16Palette, Theme, ThemeAppearance, ThemeDefinition } from './types.ts';

const BASE16_KEYS = [
  'base00',
  'base01',
  'base02',
  'base03',
  'base04',
  'base05',
  'base06',
  'base07',
  'base08',
  'base09',
  'base0A',
  'base0B',
  'base0C',
  'base0D',
  'base0E',
  'base0F',
] as const;

type Base16Key = (typeof BASE16_KEYS)[number];

// ────────────────────────────────────────────────────────────────────
// YAML parser (small subset: nested objects, scalars; no arrays/anchors)
// ────────────────────────────────────────────────────────────────────

function parseScalar(s: string): unknown {
  const t = s.trim();
  if (t === '') return null;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

/**
 * Tiny YAML parser. Handles `key: value` lines and indented nested
 * objects. Doesn't handle: arrays, multi-line strings, anchors,
 * folded blocks. Sufficient for theme files; for anything richer,
 * use JSON.
 */
export function parseYaml(src: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: root }];

  for (const raw of src.split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue;
    const line = raw.replace(/(\s)#.*$/, '$1');
    if (!line.trim()) continue;

    const m = line.match(/^( *)([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const indent = m[1]!.length;
    const key = m[2]!;
    const rawValue = m[3]!;

    while (stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!.obj;

    if (rawValue.trim() === '') {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }

  return root;
}

// ────────────────────────────────────────────────────────────────────
// Color helpers
// ────────────────────────────────────────────────────────────────────

function normalizeHex(value: string): string {
  const v = value.trim().replace(/^['"]|['"]$/g, '');
  if (v.startsWith('#')) return v.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v.toLowerCase()}`;
  if (/^0x[0-9a-fA-F]{6}$/.test(v)) return `#${v.slice(2).toLowerCase()}`;
  throw new Error(`Invalid hex color: "${value}"`);
}

function paletteFromRecord(rec: Record<string, unknown>): Base16Palette {
  const palette = {} as Base16Palette;
  for (const k of BASE16_KEYS) {
    const v = rec[k];
    if (typeof v !== 'string') {
      throw new Error(`Missing or invalid base16 key "${k}"`);
    }
    palette[k as Base16Key] = normalizeHex(v);
  }
  return palette;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function appearanceFromPalette(p: Base16Palette): ThemeAppearance {
  return relativeLuminance(p.base00) > 0.5 ? 'light' : 'dark';
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ────────────────────────────────────────────────────────────────────
// Deep merge (used by override layering)
// ────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep merge `override` onto `base`. Plain objects merge recursively;
 * anything else (arrays, primitives) replaces. `undefined` values in
 * `override` are ignored — they never unset.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T;
  }
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    if (ov === undefined) continue;
    out[key] = key in base ? deepMerge(base[key], ov) : ov;
  }
  return out as T;
}

// ────────────────────────────────────────────────────────────────────
// File parsing
// ────────────────────────────────────────────────────────────────────

function readParsed(filePath: string): Record<string, unknown> {
  const src = readFileSync(filePath, 'utf8');
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return JSON.parse(src);
  return parseYaml(src);
}

function isFlatBase16(rec: Record<string, unknown>): boolean {
  return BASE16_KEYS.every((k) => typeof rec[k] === 'string');
}

function isRichDefinition(rec: Record<string, unknown>): boolean {
  return isPlainObject(rec.palette);
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export interface Base16ToThemeOptions {
  name?: string;
  displayName?: string;
  appearance?: ThemeAppearance;
}

export function themeFromBase16(
  record: Record<string, unknown>,
  options: Base16ToThemeOptions = {},
): Theme {
  const palette = paletteFromRecord(record);
  const sourceName =
    (typeof record.scheme === 'string' && record.scheme) ||
    (typeof record.name === 'string' && record.name) ||
    'custom';
  const name = options.name ?? slugify(sourceName as string);
  const displayName = options.displayName ?? (sourceName as string);
  const appearance = options.appearance ?? appearanceFromPalette(palette);

  return defineTheme({ name, displayName, appearance, palette });
}

function themeFromRichDefinition(
  rec: Record<string, unknown>,
  options: Base16ToThemeOptions = {},
): Theme {
  const palette = paletteFromRecord(rec.palette as Record<string, unknown>);
  const def: ThemeDefinition = {
    name: options.name ?? (typeof rec.name === 'string' ? rec.name : 'custom'),
    displayName:
      options.displayName ??
      (typeof rec.displayName === 'string'
        ? rec.displayName
        : typeof rec.name === 'string'
          ? rec.name
          : 'Custom'),
    appearance:
      options.appearance ??
      (rec.appearance === 'light' || rec.appearance === 'dark'
        ? rec.appearance
        : appearanceFromPalette(palette)),
    palette,
    overrides: (rec.overrides ?? undefined) as ThemeDefinition['overrides'],
  };
  return defineTheme(def);
}

/** Load a full theme file (base16 record OR rich ThemeDefinition). */
export function loadThemeFile(filePath: string, options: Base16ToThemeOptions = {}): Theme {
  const rec = readParsed(filePath);
  if (isFlatBase16(rec)) return themeFromBase16(rec, options);
  if (isRichDefinition(rec)) return themeFromRichDefinition(rec, options);
  throw new Error(
    `${filePath}: not a recognized theme file (expected base16 keys or a "palette" block).`,
  );
}

/**
 * Load a partial-override file. The file's structure mirrors `Theme`
 * (e.g. `colors.primary`, `components.button.sizes.md.paddingX`).
 */
export function loadOverrideFile(filePath: string): Partial<Theme> {
  const rec = readParsed(filePath);
  if (isFlatBase16(rec)) {
    throw new Error(
      `${filePath}: looks like a full base16 theme, not an override. ` +
        `Use loadThemeFile() instead.`,
    );
  }
  return rec as Partial<Theme>;
}

/** Deep-merge a partial override into a resolved theme. */
export function applyOverride(theme: Theme, override: Partial<Theme>): Theme {
  return deepMerge(theme, override);
}

export function applyOverrideFile(theme: Theme, filePath: string): Theme {
  return applyOverride(theme, loadOverrideFile(filePath));
}

/** Backwards-compat alias for the old loader. */
export const loadBase16File = loadThemeFile;

// ────────────────────────────────────────────────────────────────────
// Tinty artifact
// ────────────────────────────────────────────────────────────────────

export function loadTintyArtifact(options: Base16ToThemeOptions = {}): Theme | null {
  const explicit = process.env.TINTY_OPENTUI_THEME;
  const home = process.env.HOME ?? '';
  const fallback = home
    ? `${home}/.local/share/tinted-theming/tinty/tinted-opentui-themes-file.json`
    : null;
  const candidate = explicit ?? fallback;
  if (!candidate || !existsSync(candidate)) return null;
  return loadThemeFile(candidate, options);
}
