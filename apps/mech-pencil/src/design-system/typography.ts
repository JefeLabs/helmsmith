/**
 * Framework-agnostic typography foundation model.
 *
 * The core DECISION a `FrameworkAdapter.foundations()` records here is the
 * **voice**: one family for everything (`mode: "single"`) or a complementary
 * **set** (`mode: "set"` — a distinct display face paired with a body face),
 * plus a mono for code. Each `TypeStep` carries a `role` so the page (and any
 * component) binds the right family token: display steps → `$font.display`,
 * body steps → `$font.family`, code steps → `$font.mono`. Sizes are scalar
 * tokens (`$font.<step>.size`) so the foundation and components stay in
 * lockstep, exactly like the icon size scale.
 */

/** Which family role a step renders in. */
export type TypeRole = 'display' | 'body' | 'mono';

export interface TypeStep {
  /** Style name, e.g. `"h1"`, `"body-md"`, `"code-sm"`. */
  name: string;
  /** Scalar token key for the font size, e.g. `"font.h1.size"`. */
  sizeKey: string;
  /** Family role → the family token the page/component binds. */
  role: TypeRole;
  /** Font weight (CSS numeric string, e.g. `"700"`). */
  weight: string;
  /** Line-height as a ratio of the font size (Pencil's `lineHeight`). */
  lineHeight: number;
  /** Specimen text rendered on the foundation page. */
  sample: string;
}

export interface TypographyFoundation {
  /** `single` = display === body; `set` = a complementary pairing. */
  mode: 'single' | 'set';
  /** Headings face (token `font.display`). */
  displayFamily: string;
  /** Body / UI face (token `font.family`). */
  bodyFamily: string;
  /** Monospace face for code (token `font.mono`). */
  monoFamily: string;
  /** The type scale, large → small. */
  steps: TypeStep[];
}

/** Family token key for a role (what a step/component references). */
export function familyToken(role: TypeRole): string {
  return role === 'display' ? 'font.display' : role === 'mono' ? 'font.mono' : 'font.family';
}
