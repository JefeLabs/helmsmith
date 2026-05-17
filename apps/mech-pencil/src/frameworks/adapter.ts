/**
 * `FrameworkAdapter` — the single extensibility seam of mech-pencil.
 *
 * Everything framework-specific (HeroUI v3 today; HeroUI Pro, v2,
 * Material, etc. tomorrow) lives behind this interface. The emitters
 * (`emit/library.ts`, `emit/mockup.ts`) and every CLI command talk
 * only to this contract — they never import `heroui/` directly.
 *
 * The split is deliberate:
 *
 *   tokens()      → the design-system.lib.pen `variables` + `themes`
 *   components()  → the `reusable` component definitions in that lib
 *   mockups()     → base `.pen` files that `import` the lib and compose
 *                   refs into representative screens
 *
 * To add a framework you implement this interface and register it in
 * `registry.ts` — no emitter or command changes.
 */

import type { ComponentSpec } from '../design-system/atomic.ts';
import type { TokenSet } from '../design-system/tokens.ts';
import type { Child } from '../pen/schema.ts';

/**
 * A base mockup the adapter ships as a starting point. It is emitted as
 * its own `.pen` that imports the design system under `imports.ds`, so
 * `build()` should reference components as `ds/<component-id>`.
 */
export interface MockupSpec {
  /** File slug (becomes `<slug>.pen`). */
  slug: string;
  /** Human title. */
  name: string;
  /** Top-level nodes of the mockup (typically one screen `frame`). */
  build: (ctx: MockupContext) => Child[];
}

export interface MockupContext {
  /** `ds/<id>` — instantiate a library component in the mockup. */
  component: (id: string) => string;
  /** `$<key>` — reference a library design token. */
  token: (key: string) => string;
}

export interface FrameworkAdapter {
  /** Stable id used as `--framework <id>` and in the registry. */
  id: string;
  /** Human title shown in `mech-pencil list`. */
  title: string;
  /** One-line description. */
  description: string;
  /** Upstream docs/reference URL. */
  reference?: string;

  /** Resolved, static design tokens (colors pre-resolved per theme). */
  tokens(): TokenSet;
  /** The atomic component catalog emitted into the library. */
  components(): ComponentSpec[];
  /** Optional starter mockups that reference the library. */
  mockups?(): MockupSpec[];
  /**
   * Non-fatal diagnostics surfaced to the user (e.g. "derived tokens
   * skipped — implement mixOklab()"). Lets a partially-implemented
   * adapter explain what's degraded without failing the command.
   */
  notes?(): string[];
}
