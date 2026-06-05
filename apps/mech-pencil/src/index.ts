/**
 * @ecruz165/mech-pencil — programmatic API.
 *
 * The CLI (`src/cli.ts`) is the primary surface, but the .pen schema
 * engine and emitters are exported so other toolbox code can build
 * Pencil documents directly.
 *
 *   import { PenDocument, validateDocument } from '@ecruz165/mech-pencil';
 *   import { emitDocument, getFramework } from '@ecruz165/mech-pencil';
 */

// .pen schema engine
export * from './pen/schema.ts';
export * from './pen/builder.ts';
export { PenDocument } from './pen/document.ts';
export {
  type ValidationIssue,
  type ValidationResult,
  validateDocument,
} from './pen/validate.ts';

// Design-system model
export * from './design-system/tokens.ts';
export {
  type AtomicLevel,
  type BuildContext,
  type ComponentSpec,
  ATOMIC_ORDER,
  defaultBuildContext,
} from './design-system/atomic.ts';

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

// Emitters
export {
  type EmitOptions,
  type EmittedDocument,
  emitDocument,
} from './emit/document.ts';
export { type EmittedBrand, emitBrand } from './emit/brand.ts';
export { type EmittedBundle, emitBundle } from './emit/bundle.ts';
export {
  type Manifest,
  type ManifestComponent,
  type ManifestToken,
  buildManifest,
} from './manifest/build.ts';
export {
  CATEGORY_ORDER,
  categoryOf,
  heroUIComponents,
  reactName,
} from './frameworks/heroui/catalog.ts';

// Brand tokens
export {
  type BrandFile,
  type Ramp,
  assertBrandFile,
} from './brand/schema.ts';
export { type BrandTokens, brandToTokens } from './brand/to-tokens.ts';

// HeroUI Themes-style theme generation
export {
  type RadiusId,
  type ThemeConfig,
  DEFAULT_THEME,
  RADIUS_REM,
  resolveTheme,
} from './theme/config.ts';
export { themeTokens } from './theme/generate.ts';
export { deriveTokens } from './frameworks/heroui/derive.ts';

// Color engine (token pre-resolver)
export { type Lab, parseColor, toHex } from './color/oklch.ts';
export { ColorMixNotImplemented, mixOklab } from './color/mix.ts';
