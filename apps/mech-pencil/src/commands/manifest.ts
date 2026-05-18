/**
 * `mech-pencil manifest` — emit the compact component/token/constraint
 * index. Prints to stdout (pipeable) or writes a file with `-o`.
 * Deterministic: no model calls, no theme dependence.
 */

import { resolve } from 'node:path';
import { buildManifest } from '../manifest/build.ts';
import { dim, ok } from '../ui.ts';
import { writeText } from '../lib/workspace.ts';

export interface ManifestCmdOptions {
  out?: string;
}

export function runManifest(options: ManifestCmdOptions = {}): void {
  const json = `${JSON.stringify(buildManifest(), null, 2)}\n`;
  if (!options.out) {
    process.stdout.write(json);
    return;
  }
  const file = resolve(options.out);
  writeText(file, json);
  const m = buildManifest();
  console.log(ok(file));
  console.log(
    dim(`  ${m.componentCount} components · ${m.tokens.length} tokens · ${m.constraints.length} constraints`),
  );
}
