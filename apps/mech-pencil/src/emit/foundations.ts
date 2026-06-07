/**
 * Emit per-foundation token libs + decision previews (option A).
 *
 * For each foundation (colors · typography · icons · grids):
 *   - `<slug>.lib.pen`     — variables-only, JUST this foundation's token
 *                            slice (color.* / font.* / icon.* / space+grid+…).
 *                            Importable under `$<alias>:`.
 *   - `<slug>.preview.pen` — the decision page, importing every foundation lib
 *                            it references (a page tints with `$colors:` and
 *                            labels with `$type:`, so it imports those too).
 *
 * Deterministic — no LLM, no rasterization. PNGs (if wanted) come from a
 * headless render of the `.preview.pen`, never from a model.
 */

import type { TokenSet } from '../design-system/tokens.ts';
import { FOUNDATIONS, multiAliasContext, slugForAlias } from '../frameworks/heroui/foundations.ts';
import { PenDocument } from '../pen/document.ts';
import type { Child, VariableDecl } from '../pen/schema.ts';
import { type ValidationResult, validateDocument } from '../pen/validate.ts';

const seg = (key: string) => key.split('.')[0];

function colorDecl(values: { light: string; dark: string }): VariableDecl {
  return {
    type: 'color',
    value: [
      { value: values.light, theme: { mode: 'light' } },
      { value: values.dark, theme: { mode: 'dark' } },
    ],
  };
}

function scalarDecl(s: { type: 'number' | 'string'; value: number | string }): VariableDecl {
  return s.type === 'number'
    ? { type: 'number', value: s.value as number }
    : { type: 'string', value: s.value as string };
}

/** Aliases referenced anywhere in a node tree (`$alias:key`). */
function referencedAliases(nodes: Child[]): string[] {
  const out = new Set<string>();
  const re = /\$([a-z][a-z0-9]*):/g;
  let m: RegExpExecArray | null;
  const json = JSON.stringify(nodes);
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(json)) !== null) out.add(m[1]);
  return [...out];
}

export interface FoundationArtifact {
  slug: string;
  libPath: string;
  lib: PenDocument;
  libValidation: ValidationResult;
  previewPath: string;
  preview: PenDocument;
  previewValidation: ValidationResult;
  /** Aliases the preview imports. */
  imports: string[];
}

export function emitFoundations(tokens: TokenSet): FoundationArtifact[] {
  const ctx = multiAliasContext();
  const arts: FoundationArtifact[] = [];

  for (const f of FOUNDATIONS) {
    const colors = tokens.colors.filter((c) => f.prefixes.includes(seg(c.key)));
    const scalars = tokens.scalars.filter((s) => f.prefixes.includes(seg(s.key)));

    // The token lib — variables only; theme axis only when it carries colors.
    const lib = new PenDocument();
    if (colors.length > 0) for (const { axis, values } of tokens.axes) lib.axis(axis, values);
    for (const c of colors) lib.variable(c.key, colorDecl(c.values));
    for (const s of scalars) lib.variable(s.key, scalarDecl(s));

    // The decision preview — imports every foundation lib it references.
    const page = f.spec.build(ctx);
    const imports = referencedAliases(page).filter((a) => slugForAlias(a));
    const preview = new PenDocument();
    for (const { axis, values } of tokens.axes) preview.axis(axis, values);
    for (const alias of imports) preview.importLib(alias, `./${slugForAlias(alias)}.lib.pen`);
    // Position page roots so the headless export can compute a valid bbox
    // (document root has no layout — unpositioned nodes break `--export`).
    let py = 0;
    for (const node of page) {
      const p = node as Child & { x?: number; y?: number; height?: unknown };
      p.x = 0;
      p.y = py;
      py += (typeof p.height === 'number' ? p.height : 900) + 96;
      preview.add(node);
    }

    arts.push({
      slug: f.slug,
      libPath: `foundations/${f.slug}.lib.pen`,
      lib,
      libValidation: validateDocument(lib.toObject()),
      previewPath: `foundations/${f.slug}.preview.pen`,
      preview,
      previewValidation: validateDocument(preview.toObject()),
      imports,
    });
  }

  return arts;
}