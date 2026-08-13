/**
 * `@helmsmith/flow-spec/tenancy` — product/repo/context-source shapes
 * and the tenancy-aware unified validator. These live in the spec
 * because `validateUnifiedCatalog` needs them; consumers that only
 * author flows use `./definition` and never see a clone URL.
 */
export {
  type Catalog,
  type ContextSourceDef,
  findProduct,
  type ProductDef,
  type ProductRepo,
} from './types.ts';
export { validateUnifiedCatalog } from './validate.ts';
