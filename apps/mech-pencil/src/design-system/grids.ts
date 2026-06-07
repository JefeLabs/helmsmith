/**
 * Framework-agnostic grids & spacing foundation model.
 *
 * Two decisions: a **spacing scale** (`$space.*` scalar tokens components
 * pad/gap with) and a **layout grid** (`$grid.columns/gutter/margin/max`).
 * The foundation page visualizes both from the same tokens — change `space.4`
 * once and every component that gaps by it moves, same lockstep as icons/type.
 */

export interface GridSpacingFoundation {
  /** Spacing scale — scalar token keys, small → large (e.g. `["space.1", … "space.16"]`). */
  spaceKeys: string[];
  /** Token key for the column count (`grid.columns`). */
  columnsKey: string;
  /** Token key for the inter-column gutter (`grid.gutter`). */
  gutterKey: string;
  /** Token key for the outer margin (`grid.margin`). */
  marginKey: string;
  /** Token key for the max content width (`grid.max`). */
  maxWidthKey: string;
  /** Column count literal — needed to draw N columns; mirrors `columnsKey`'s value. */
  columns: number;
}
