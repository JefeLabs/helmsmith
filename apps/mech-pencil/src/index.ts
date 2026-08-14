/**
 * @helmsmith/mech-pencil — programmatic API.
 *
 * The CLI (`src/cli.ts`) is the primary surface, but the .pen schema
 * engine and emitters are exported so other toolbox code can build
 * Pencil documents directly.
 *
 *   import { PenDocument, validateDocument } from '@helmsmith/mech-pencil';
 *   import { emitDocument, getFramework } from '@helmsmith/mech-pencil';
 */

// Brand tokens
export {
  assertBrandFile,
  type BrandFile,
  type Ramp,
} from './brand/schema.ts';
export { type BrandTokens, brandToTokens } from './brand/to-tokens.ts';
export { ColorMixNotImplemented, mixOklab } from './color/mix.ts';
// Color engine (token pre-resolver)
export { type Lab, parseColor, toHex } from './color/oklch.ts';
export {
  ATOMIC_ORDER,
  type AtomicLevel,
  type BuildContext,
  type ComponentSpec,
  defaultBuildContext,
} from './design-system/atomic.ts';
// Design-system model
export * from './design-system/tokens.ts';
export { type EmittedBrand, emitBrand } from './emit/brand.ts';
export { type EmittedBundle, emitBundle } from './emit/bundle.ts';

// Emitters
export {
  type EmitOptions,
  type EmittedDocument,
  emitDocument,
} from './emit/document.ts';
// Framework adapters
export type {
  FrameworkAdapter,
  MockupContext,
  MockupSpec,
} from './frameworks/_core/adapter.ts';
export {
  DEFAULT_FRAMEWORK,
  getFramework,
  listFrameworks,
} from './frameworks/_core/registry.ts';
export {
  CATEGORY_ORDER,
  categoryOf,
  heroUIComponents,
  reactName,
} from './frameworks/heroui/catalog.ts';
export { deriveTokens } from './frameworks/heroui/derive.ts';
export {
  buildManifest,
  type Manifest,
  type ManifestComponent,
  type ManifestToken,
} from './manifest/build.ts';
export * from './pen/builder.ts';
export { PenDocument } from './pen/document.ts';
// .pen schema engine
export * from './pen/schema.ts';
export {
  type ValidationIssue,
  type ValidationResult,
  validateDocument,
} from './pen/validate.ts';
// HeroUI Themes-style theme generation
export {
  DEFAULT_THEME,
  RADIUS_REM,
  type RadiusId,
  resolveTheme,
  type ThemeConfig,
} from './theme/config.ts';
export { themeTokens } from './theme/generate.ts';
