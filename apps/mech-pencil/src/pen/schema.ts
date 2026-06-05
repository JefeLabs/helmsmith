/**
 * The Pencil `.pen` file format — schema v2.11.
 *
 * Transcribed from the authoritative spec at
 * https://docs.pencil.dev/for-developers/the-pen-format
 *
 * A `.pen` (mockup) and a `.lib.pen` (design library) share this exact
 * `Document` shape — the library distinction is operational (it exports
 * `reusable` components for other files to `import`), not structural.
 *
 * The on-disk format is plain, pretty-printed, git-friendly JSON. This
 * module is the single source of truth for what a valid document looks
 * like; everything else in this app builds toward emitting it.
 *
 * The spec is explicitly unstable ("we reserve the right to introduce
 * breaking changes"), so the version literal is pinned.
 */

export const PEN_VERSION = '2.11' as const;
export type PenVersion = typeof PEN_VERSION;

/** A theme-axis selector, e.g. `{ mode: "dark" }`. */
export interface Theme {
  [axis: string]: string;
}

/** A `$`-prefixed reference to a `Document.variables` key, e.g. `"$color.accent"`. */
export type Variable = string;

export type NumberOrVariable = number | Variable;
export type Color = string;
export type ColorOrVariable = Color | Variable;
export type BooleanOrVariable = boolean | Variable;
export type StringOrVariable = string | Variable;

export interface Layout {
  layout?: 'none' | 'vertical' | 'horizontal';
  gap?: NumberOrVariable;
  layoutIncludeStroke?: boolean;
  /** all sides | [horizontal, vertical] | [top, right, bottom, left] */
  padding?:
    | NumberOrVariable
    | [NumberOrVariable, NumberOrVariable]
    | [NumberOrVariable, NumberOrVariable, NumberOrVariable, NumberOrVariable];
  justifyContent?: 'start' | 'center' | 'end' | 'space_between' | 'space_around';
  alignItems?: 'start' | 'center' | 'end';
}

/** Dynamic layout size: `fit_content` | `fill_container` (optional
 * fallback in parens, e.g. `fit_content(100)`). */
export type SizingBehavior = string;

export interface Position {
  x?: number;
  y?: number;
}

export interface Size {
  width?: NumberOrVariable | SizingBehavior;
  height?: NumberOrVariable | SizingBehavior;
}

export interface CanHaveRotation {
  rotation?: NumberOrVariable;
}

export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'linearBurn'
  | 'colorBurn'
  | 'light'
  | 'screen'
  | 'linearDodge'
  | 'colorDodge'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type Fill =
  | ColorOrVariable
  | {
      type: 'color';
      enabled?: BooleanOrVariable;
      blendMode?: BlendMode;
      color: ColorOrVariable;
    }
  | {
      type: 'gradient';
      enabled?: BooleanOrVariable;
      blendMode?: BlendMode;
      gradientType?: 'linear' | 'radial' | 'angular';
      opacity?: NumberOrVariable;
      center?: Position;
      size?: { width?: NumberOrVariable; height?: NumberOrVariable };
      rotation?: NumberOrVariable;
      colors?: { color: ColorOrVariable; position: NumberOrVariable }[];
    }
  | {
      type: 'image';
      enabled?: BooleanOrVariable;
      blendMode?: BlendMode;
      opacity?: NumberOrVariable;
      url: string;
      mode?: 'stretch' | 'fill' | 'fit';
    }
  | {
      type: 'mesh_gradient';
      enabled?: BooleanOrVariable;
      blendMode?: BlendMode;
      opacity?: NumberOrVariable;
      columns?: number;
      rows?: number;
      colors?: ColorOrVariable[];
      points?: (
        | [number, number]
        | {
            position: [number, number];
            leftHandle?: [number, number];
            rightHandle?: [number, number];
            topHandle?: [number, number];
            bottomHandle?: [number, number];
          }
      )[];
    };

export type Fills = Fill | Fill[];

export interface Stroke {
  align?: 'inside' | 'center' | 'outside';
  thickness?:
    | NumberOrVariable
    | {
        top?: NumberOrVariable;
        right?: NumberOrVariable;
        bottom?: NumberOrVariable;
        left?: NumberOrVariable;
      };
  join?: 'miter' | 'bevel' | 'round';
  miterAngle?: NumberOrVariable;
  cap?: 'none' | 'round' | 'square';
  dashPattern?: number[];
  fill?: Fills;
}

export type Effect =
  | { enabled?: BooleanOrVariable; type: 'blur'; radius?: NumberOrVariable }
  | { enabled?: BooleanOrVariable; type: 'background_blur'; radius?: NumberOrVariable }
  | {
      type: 'shadow';
      enabled?: BooleanOrVariable;
      shadowType?: 'inner' | 'outer';
      offset?: { x: NumberOrVariable; y: NumberOrVariable };
      spread?: NumberOrVariable;
      blur?: NumberOrVariable;
      color?: ColorOrVariable;
      blendMode?: BlendMode;
    };

export type Effects = Effect | Effect[];

export interface CanHaveGraphics {
  stroke?: Stroke;
  fill?: Fills;
  effect?: Effects;
}

export interface CanHaveEffects {
  effect?: Effects;
}

export interface Entity extends Position, CanHaveRotation {
  /** Unique within its parent scope. MUST NOT contain '/' (the slash
   * is reserved as the `descendants` id-path separator). */
  id: string;
  name?: string;
  context?: string;
  reusable?: boolean;
  theme?: Theme;
  enabled?: BooleanOrVariable;
  opacity?: NumberOrVariable;
  flipX?: BooleanOrVariable;
  flipY?: BooleanOrVariable;
  layoutPosition?: 'auto' | 'absolute';
  metadata?: { type: string; [key: string]: unknown };
}

export interface Rectangleish extends Entity, Size, CanHaveGraphics {
  cornerRadius?:
    | NumberOrVariable
    | [NumberOrVariable, NumberOrVariable, NumberOrVariable, NumberOrVariable];
}

export interface Rectangle extends Rectangleish {
  type: 'rectangle';
}

export interface Ellipse extends Entity, Size, CanHaveGraphics {
  type: 'ellipse';
  innerRadius?: NumberOrVariable;
  startAngle?: NumberOrVariable;
  sweepAngle?: NumberOrVariable;
}

export interface Line extends Entity, Size, CanHaveGraphics {
  type: 'line';
}

export interface Polygon extends Entity, Size, CanHaveGraphics {
  type: 'polygon';
  polygonCount?: NumberOrVariable;
  cornerRadius?: NumberOrVariable;
}

export interface Path extends Entity, Size, CanHaveGraphics {
  type: 'path';
  fillRule?: 'nonzero' | 'evenodd';
  geometry?: string;
  /** SVG coord-space [x,y,w,h] mapped onto the node box. */
  viewBox?: [number, number, number, number];
}

export interface TextStyle {
  fontFamily?: StringOrVariable;
  fontSize?: NumberOrVariable;
  fontWeight?: StringOrVariable;
  letterSpacing?: NumberOrVariable;
  fontStyle?: StringOrVariable;
  underline?: BooleanOrVariable;
  lineHeight?: NumberOrVariable;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  strikethrough?: BooleanOrVariable;
  href?: string;
}

export type TextContent = StringOrVariable;

export interface Text extends Entity, Size, CanHaveGraphics, TextStyle {
  type: 'text';
  content?: TextContent;
  textGrowth?: 'auto' | 'fixed-width' | 'fixed-width-height';
}

export interface CanHaveChildren {
  children?: Child[];
}

export interface Frame extends Rectangleish, CanHaveChildren, Layout {
  type: 'frame';
  clip?: BooleanOrVariable;
  placeholder?: boolean;
  /** `false`, or the list of component ids permitted to fill this slot. */
  slot?: false | string[];
}

export interface Group extends Entity, CanHaveChildren, CanHaveEffects {
  type: 'group';
}

export interface Note extends Entity, Size, TextStyle {
  type: 'note';
  content?: TextContent;
}

export interface Prompt extends Entity, Size, TextStyle {
  type: 'prompt';
  content?: TextContent;
  model?: StringOrVariable;
}

export interface Context extends Entity, Size, TextStyle {
  type: 'context';
  content?: TextContent;
}

export interface IconFont extends Entity, Size, CanHaveEffects {
  type: 'icon_font';
  iconFontName?: StringOrVariable;
  iconFontFamily?: StringOrVariable;
  /**
   * The spec interface names `iconFontName`, but every example in the
   * docs uses `icon` (e.g. `"icon": "check"`). Both are accepted via
   * the loose `Ref` index signature; we emit `icon` to match examples.
   */
  icon?: StringOrVariable;
  weight?: NumberOrVariable;
  fill?: Fills;
}

/** Generates nested children from a JavaScript file (`scriptUri`). */
export interface Script extends Entity, Size {
  type: 'script';
  clip?: BooleanOrVariable;
  scriptUri?: string;
  inputs?: { [key: string]: string | number | boolean | Variable };
}

/**
 * An instance of a `reusable` component. `ref` is the target component
 * id. Cross-file refs (`alias:componentId`, colon-delimited) resolve
 * but CANNOT be customized via `descendants` — only root-level props
 * on the ref cross an import. For customizable instances the component
 * must be local to the same document. Root overrides go directly on
 * the ref (index signature); nested patches go through `descendants`
 * keyed by a `/`-joined id path (slash is legal in the KEY, never in
 * a node `id`).
 */
export interface Ref extends Entity {
  type: 'ref';
  ref: string;
  descendants?: {
    [idPath: string]: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export type Child =
  | Frame
  | Group
  | Rectangle
  | Ellipse
  | Line
  | Path
  | Polygon
  | Text
  | Note
  | Prompt
  | Context
  | IconFont
  | Script
  | Ref;

/** Every `type` discriminator value a `Child` may carry. */
export const CHILD_TYPES = [
  'frame',
  'group',
  'rectangle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'text',
  'note',
  'prompt',
  'context',
  'icon_font',
  'script',
  'ref',
] as const;
export type ChildType = (typeof CHILD_TYPES)[number];

export type VariableType = 'boolean' | 'color' | 'number' | 'string';

type ThemedValue<V> = V | { value: V; theme?: Theme }[];

export type VariableDecl =
  | { type: 'boolean'; value: ThemedValue<BooleanOrVariable> }
  | { type: 'color'; value: ThemedValue<ColorOrVariable> }
  | { type: 'number'; value: ThemedValue<NumberOrVariable> }
  | { type: 'string'; value: ThemedValue<StringOrVariable> };

export interface Document {
  version: PenVersion;
  /** Theme axes → their allowed values, e.g. `{ mode: ["light","dark"] }`. */
  themes?: { [axis: string]: string[] };
  /** Import alias → relative path to another `.pen`/`.lib.pen`. */
  imports?: { [alias: string]: string };
  /** Design tokens. Reference a key elsewhere as the string `"$<key>"`. */
  variables?: { [key: string]: VariableDecl };
  children: Child[];
}
