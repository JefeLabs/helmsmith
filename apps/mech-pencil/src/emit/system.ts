/**
 * Assemble the full option-A system (deterministic, zero-LLM):
 *
 *   foundations/<slug>.lib.pen + .preview.pen   per-foundation token libs
 *   components/<cat>.lib.pen   + .preview.pen   per-category component libs,
 *                                               importing ONLY the foundation
 *                                               libs their components reference
 *   base.pen                                    imports every foundation lib;
 *                                               a LOCAL component palette
 *                                               (editable) + demo screens
 *
 * Cross-file rule (verified): only foundation VARIABLES import safely; a
 * component instance's `descendants` overrides don't cross files. So the base
 * keeps LOCAL component copies (editable) and the component libs are for
 * browsing — both bind tokens via the multi-alias foundation imports.
 */

import type { ComponentSpec } from '../design-system/atomic.ts';
import type { TokenSet } from '../design-system/tokens.ts';
import { CATEGORY_ORDER, heroUIComponents } from '../frameworks/heroui/catalog.ts';
import {
  FOUNDATIONS,
  aliasesReferenced,
  multiAliasBuildContext,
  multiAliasContext,
  slugForAlias,
} from '../frameworks/heroui/foundations.ts';
import { heroUIAdapter } from '../frameworks/heroui/index.ts';
import { PAGE_TEMPLATES, VIEWPORTS } from '../frameworks/heroui/templates.ts';
import { frame, text } from '../pen/builder.ts';
import { PenDocument } from '../pen/document.ts';
import type { Child } from '../pen/schema.ts';
import { type ValidationResult, validateDocument } from '../pen/validate.ts';
import { type FoundationArtifact, emitFoundations } from './foundations.ts';
import { type TemplateArtifact, emitTemplates } from './templates.ts';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const heading = (id: string, s: string, big = true): Child =>
  text(id, s, {
    fill: `$colors:color.${big ? 'foreground' : 'muted'}`,
    fontFamily: '$type:font.family',
    fontSize: big ? 24 : 13,
    fontWeight: big ? '700' : '600',
  });

function importFoundations(doc: PenDocument, aliases: string[], rel: string): void {
  for (const a of aliases) {
    const slug = slugForAlias(a);
    if (slug) doc.importLib(a, `${rel}${slug}.lib.pen`);
  }
}

function catalogFrame(id: string, title: string, specs: ComponentSpec[]): Child {
  const ctx = multiAliasBuildContext();
  return frame(
    id,
    { name: title, x: 0, y: 0, layout: 'vertical', gap: 24, padding: 32, fill: '$colors:color.background' },
    [
      heading(`${id}-h`, title),
      frame(`${id}-items`, { name: 'Items', layout: 'vertical', width: 'fit_content', gap: 16 }, specs.map((s) => s.build(ctx))),
    ],
  );
}

export interface SystemFile {
  path: string;
  doc: PenDocument;
  validation: ValidationResult;
}

export interface SystemBundle {
  foundations: FoundationArtifact[];
  components: (SystemFile & { category: string; count: number; imports: string[]; preview: SystemFile })[];
  templates: TemplateArtifact[];
  base: SystemFile & { imports: string[]; screens: string[]; demos: string[] };
}

export function emitSystem(tokens: TokenSet): SystemBundle {
  const foundations = emitFoundations(tokens);
  const templates = emitTemplates(tokens);
  const specs = heroUIComponents();

  // Per-category component libs — import only the foundation libs referenced.
  const components: SystemBundle['components'] = [];
  for (const category of CATEGORY_ORDER) {
    const inCat = specs.filter((s) => s.category === category);
    if (inCat.length === 0) continue;
    const slug = slugify(category);
    const node = catalogFrame(`core-${slug}`, `${category} · HeroUI v3`, inCat);
    const aliases = aliasesReferenced(JSON.stringify([node]));

    const lib = new PenDocument();
    importFoundations(lib, aliases, '../foundations/');
    lib.add(node);

    const preview = new PenDocument();
    importFoundations(preview, aliases, '../foundations/');
    preview.add(structuredClone(node));

    components.push({
      category,
      count: inCat.length,
      imports: aliases,
      path: `components/${slug}.lib.pen`,
      doc: lib,
      validation: validateDocument(lib.toObject()),
      preview: {
        path: `components/${slug}.preview.pen`,
        doc: preview,
        validation: validateDocument(preview.toObject()),
      },
    });
  }

  // base.pen — imports every foundation lib; LOCAL component palette + screens.
  const base = new PenDocument();
  for (const f of FOUNDATIONS) base.importLib(f.alias, `./foundations/${f.slug}.lib.pen`);
  const palette = catalogFrame('base-components', `Components · ${specs.length} (local & editable)`, specs);
  (palette as Child & { x?: number }).x = 1600;
  base.add(palette);

  const mockCtx = multiAliasContext();
  const screens: string[] = [];
  let cursorY = 0;
  for (const spec of heroUIAdapter.mockups?.() ?? []) {
    for (const node of spec.build(mockCtx)) {
      const p = node as Child & { x?: number; y?: number; height?: unknown };
      p.x = 0;
      p.y = cursorY;
      cursorY += (typeof p.height === 'number' ? p.height : 900) + 96;
      base.add(node);
    }
    screens.push(spec.slug);
  }

  // Demo the desktop page templates by INLINING them (local copies). A cross-file
  // ref to an IMPORTED page doesn't resolve its nested component refs (renders
  // black), so we rebuild each page here: its card/button refs resolve against
  // base's local palette, and its $tokens against the foundation imports.
  const demos: string[] = [];
  const desktop = VIEWPORTS.find((v) => v.id === 'desktop') ?? VIEWPORTS[0];
  let demoX = -1800;
  for (const t of PAGE_TEMPLATES) {
    const page = t.build(mockCtx, desktop);
    const p = page as Child & { x?: number; y?: number };
    p.x = demoX;
    p.y = 0;
    demoX -= desktop.width + 160;
    base.add(page);
    demos.push(`${t.id}-desktop`);
  }

  return {
    foundations,
    components,
    templates,
    base: {
      path: 'base.pen',
      doc: base,
      validation: validateDocument(base.toObject()),
      imports: FOUNDATIONS.map((f) => f.alias),
      screens,
      demos,
    },
  };
}