/**
 * Color parsing + conversion for the token pre-resolver.
 *
 * HeroUI v3 expresses theme colors as `oklch(L C H)` and derives
 * hover/soft/secondary surfaces at runtime via CSS `color-mix(in
 * oklab, …)`. `.pen` variables are static, so we resolve all of that
 * at generation time — which means doing the OKLab/OKLCH ↔ sRGB math
 * ourselves.
 *
 * Internal working representation is OKLab + straight (non-premultiplied)
 * alpha, because that's the space `color-mix(in oklab, …)` interpolates
 * in (see `mix.ts`). We only convert to sRGB hex at the very end.
 *
 * The conversion matrices are Björn Ottosson's reference values
 * (https://bottosson.github.io/posts/oklab/) — these are not a design
 * choice, they're the definition of the color space.
 */

export interface Lab {
  /** OKLab lightness (~0..1). */
  L: number;
  /** OKLab green–red axis. */
  a: number;
  /** OKLab blue–yellow axis. */
  b: number;
  /** Straight alpha 0..1. */
  alpha: number;
}

/** The CSS `transparent` keyword: alpha 0 with no meaningful color. */
export const TRANSPARENT: Lab = { L: 0, a: 0, b: 0, alpha: 0 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Linear-light sRGB triplet (0..1) → OKLab. */
function linearRgbToOklab(r: number, g: number, b: number): Omit<Lab, 'alpha'> {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

/** OKLab → gamut-clipped 8-bit sRGB channels. */
function oklabToSrgb255(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [
    Math.round(clamp01(linearToSrgb(r)) * 255),
    Math.round(clamp01(linearToSrgb(g)) * 255),
    Math.round(clamp01(linearToSrgb(bl)) * 255),
  ];
}

function oklchToLab(L: number, C: number, hDeg: number, alpha: number): Lab {
  const h = (hDeg * Math.PI) / 180;
  return { L, a: C * Math.cos(h), b: C * Math.sin(h), alpha };
}

/** Parse a `0..1` number or a `NN%` percentage into `0..1`. */
function num(token: string): number {
  return token.endsWith('%') ? Number.parseFloat(token) / 100 : Number.parseFloat(token);
}

/**
 * Parse any color string HeroUI v3 produces:
 *   - `oklch(L C H)` / `oklch(L C H / a)` (L may be a percentage)
 *   - `#RGB`, `#RRGGBB`, `#RRGGBBAA`
 *   - `rgb(...)` / `rgba(...)`
 *   - the `transparent` keyword
 */
export function parseColor(input: string): Lab {
  const s = input.trim().toLowerCase();

  if (s === 'transparent') return { ...TRANSPARENT };

  const oklch = s.match(/^oklch\(\s*([^)]+?)\s*\)$/);
  if (oklch) {
    const [coords, alphaPart] = oklch[1].split('/').map((p) => p.trim());
    const [lT, cT, hT] = coords.split(/\s+/);
    const alpha = alphaPart ? num(alphaPart) : 1;
    return oklchToLab(num(lT), Number.parseFloat(cT), Number.parseFloat(hT || '0'), alpha);
  }

  const rgb = s.match(/^rgba?\(\s*([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,/]/).map((p) => p.trim());
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p) > 1 || /\d{2,}/.test(p) ? Number.parseFloat(p) / 255 : Number.parseFloat(p));
    const alpha = parts[3] !== undefined ? num(parts[3]) : 1;
    const lab = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
    return { ...lab, alpha };
  }

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = Number.parseInt(h.slice(0, 2), 16) / 255;
    const g = Number.parseInt(h.slice(2, 4), 16) / 255;
    const b = Number.parseInt(h.slice(4, 6), 16) / 255;
    const alpha = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
    const lab = linearRgbToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
    return { ...lab, alpha };
  }

  throw new Error(`mech-pencil: cannot parse color "${input}"`);
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/**
 * Serialize OKLab → the most portable Pencil fill value: `#RRGGBB`,
 * or `#RRGGBBAA` when the color carries partial alpha (Pencil accepts
 * 8-digit hex; this is how pre-resolved "soft" tokens keep their
 * translucency without a runtime `color-mix`).
 */
export function toHex({ L, a, b, alpha }: Lab): string {
  const [r, g, bl] = oklabToSrgb255(L, a, b);
  const base = `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
  if (alpha >= 1) return base;
  return `${base}${hex2(Math.round(clamp01(alpha) * 255))}`;
}
