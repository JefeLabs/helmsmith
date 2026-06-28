/**
 * `mech-pencil brand <brand.json>` — emit the two-file themed system:
 * `brand.pen` (swappable tokens) + `design.pen` (components + mockups
 * bound to `$brand:*`). Re-run with a different brand.json to reskin.
 */

import { resolve } from 'node:path';
import { assertBrandFile, type BrandFile } from '../brand/schema.ts';
import { emitBrand } from '../emit/brand.ts';
import { getFramework } from '../frameworks/_core/registry.ts';
import { dim, err, heading, ok, warn } from '../ui.ts';
import { documentPath, readJson, writeText } from '../lib/workspace.ts';

export interface BrandOptions {
  file: string;
  framework: string;
  dir: string;
  brandName?: string;
  designName?: string;
}

export function runBrand(options: BrandOptions): void {
  const brandName = options.brandName ?? 'brand';
  const designName = options.designName ?? 'design';

  let raw: unknown;
  try {
    raw = readJson(resolve(options.file));
    assertBrandFile(raw);
  } catch (e) {
    console.error(err(`brand file: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }
  const brand = raw as BrandFile;

  const adapter = getFramework(options.framework);
  const { brandDoc, brandValidation, counts, design } = emitBrand(
    adapter,
    brand,
    brandName,
  );

  const problems = [
    ...(brandValidation.ok ? [] : [['brand', brandValidation] as const]),
    ...(design.validation.ok ? [] : [['design', design.validation] as const]),
  ];
  if (problems.length > 0) {
    for (const [label, v] of problems) {
      console.error(err(`${label}.pen invalid (${v.issues.length} issue(s)):`));
      for (const i of v.issues) console.error(dim(`  ${i.path}: ${i.message}`));
    }
    process.exitCode = 1;
    return;
  }

  const dir = resolve(options.dir);
  const brandPath = documentPath(dir, brandName);
  const designPath = documentPath(dir, designName);
  writeText(brandPath, brandDoc.toJSON());
  writeText(designPath, design.doc.toJSON());

  console.log(heading(`${adapter.title} → branded two-file system`));
  console.log(ok(`${brandPath}`));
  console.log(
    dim(
      `  ${counts.semantic} semantic · ${counts.ramps} ramp · ${counts.status} status · ${counts.scalars} scalar variables`,
    ),
  );
  console.log(ok(`${designPath}`));
  console.log(
    dim(
      `  imports brand · ${design.componentIds.length} components · ${design.screenSlugs.length} screen(s)`,
    ),
  );
  for (const note of adapter.notes?.() ?? []) console.log(warn(note));
  console.log(
    dim('  swap/regenerate brand.pen per project — design.pen is untouched.'),
  );
}
