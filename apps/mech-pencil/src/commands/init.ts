/**
 * `mech-pencil init` — generate ONE self-contained `.pen`:
 * tokens + reusable components + mockup screens, all local-ref'd so
 * the document opens and is fully customizable in Pencil.
 *
 * Refuses to write an invalid document (structural validator runs
 * first). Adapter notes (e.g. stub counts) are shown as warnings.
 */

import { resolve } from 'node:path';
import { emitDocument } from '../emit/document.ts';
import { getFramework } from '../frameworks/registry.ts';
import { dim, err, heading, ok, warn } from '../ui.ts';
import { documentPath, writeText } from '../lib/workspace.ts';

export interface GenerateOptions {
  framework: string;
  dir: string;
  name?: string;
}

export function runGenerate(options: GenerateOptions): void {
  const adapter = getFramework(options.framework);
  const { doc, validation, variableKeys, componentIds, screenSlugs } =
    emitDocument(adapter);

  if (!validation.ok) {
    console.error(err(`generated document is invalid (${validation.issues.length} issue(s)):`));
    for (const i of validation.issues) console.error(dim(`  ${i.path}: ${i.message}`));
    process.exitCode = 1;
    return;
  }

  const file = documentPath(resolve(options.dir), options.name);
  writeText(file, doc.toJSON());

  console.log(heading(`${adapter.title} → Pencil document`));
  console.log(ok(file));
  console.log(
    dim(
      `  ${variableKeys.length} tokens · ${componentIds.length} components · ${screenSlugs.length} screen(s): ${screenSlugs.join(', ')}`,
    ),
  );
  for (const note of adapter.notes?.() ?? []) console.log(warn(note));
  console.log(dim('  open it in Pencil to verify.'));
}

export function runInit(options: { framework: string; dir: string }): void {
  runGenerate({ framework: options.framework, dir: options.dir });
}
