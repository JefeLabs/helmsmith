/**
 * `mech-pencil validate <file>` — structurally validate a `.pen`
 * against the v2.11 schema rules (version, ids without `/`, unique
 * ids, local ref resolution, declared variable references).
 *
 * Reads the file as plain JSON (the documented developer file format).
 */

import { resolve } from 'node:path';
import type { Document } from '../pen/schema.ts';
import { validateDocument } from '../pen/validate.ts';
import { dim, err, ok } from '../ui.ts';
import { readJson } from '../lib/workspace.ts';

export function runValidate(file: string): void {
  const target = resolve(file);

  let doc: Document;
  try {
    doc = readJson<Document>(target);
  } catch (e) {
    console.error(err(`cannot read/parse ${target}: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const result = validateDocument(doc);
  if (result.ok) {
    console.log(ok(`${target} is a valid .pen document`));
    return;
  }

  console.error(err(`${target} — ${result.issues.length} issue(s):`));
  for (const i of result.issues) console.error(dim(`  ${i.path}: ${i.message}`));
  process.exitCode = 1;
}
