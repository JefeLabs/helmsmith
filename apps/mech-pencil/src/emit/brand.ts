/**
 * Two-file brand emit:
 *   - `brand.pen`  — variables only (raw ramps + status + scalars +
 *     concrete semantic layer). The per-project swappable file.
 *   - `design.pen` — `imports{brand}`, 72 components + mockups, every
 *     token ref `$brand:<key>` (verified cross-file variable form).
 *
 * Swap/regenerate `brand.pen` → the whole system reskins; `design.pen`
 * is untouched (components are local to it, so they resolve `$brand:`
 * against their own file's import — the Test-A-proven scenario).
 */

import type { BrandFile } from '../brand/schema.ts';
import { brandToTokens } from '../brand/to-tokens.ts';
import type { FrameworkAdapter } from '../frameworks/adapter.ts';
import { PenDocument } from '../pen/document.ts';
import { type ValidationResult, validateDocument } from '../pen/validate.ts';
import { type EmittedDocument, emitDocument } from './document.ts';

export interface EmittedBrand {
  brandDoc: PenDocument;
  brandValidation: ValidationResult;
  counts: { ramps: number; status: number; semantic: number; scalars: number };
  design: EmittedDocument;
}

export function emitBrand(
  adapter: FrameworkAdapter,
  brand: BrandFile,
  brandFileName = 'brand',
): EmittedBrand {
  const { variables, counts } = brandToTokens(brand);

  const brandDoc = new PenDocument();
  for (const [key, decl] of Object.entries(variables)) brandDoc.variable(key, decl);

  const design = emitDocument(adapter, {
    importedTokens: { alias: 'brand', path: `./${brandFileName}.pen` },
  });

  return {
    brandDoc,
    brandValidation: validateDocument(brandDoc.toObject()),
    counts,
    design,
  };
}
