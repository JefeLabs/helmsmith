/**
 * Emit page-template libs (option A, B2).
 *
 * For each template × viewport: a `templates/<id>-<vp>.lib.pen` that imports
 * only the foundation libs it references, parks LOCAL copies of the components
 * it uses (so the page's internal refs resolve in-file), and exposes the page
 * as a `reusable` node the base can import. A `.preview.pen` twin renders it.
 */

import type { TokenSet } from '../design-system/tokens.ts';
import { heroUIComponents } from '../frameworks/heroui/catalog.ts';
import {
  aliasesReferenced,
  multiAliasBuildContext,
  multiAliasContext,
  slugForAlias,
} from '../frameworks/heroui/foundations.ts';
import { PAGE_TEMPLATES, VIEWPORTS } from '../frameworks/heroui/templates.ts';
import { frame, reusable } from '../pen/builder.ts';
import { PenDocument } from '../pen/document.ts';
import type { Child } from '../pen/schema.ts';
import { type ValidationResult, validateDocument } from '../pen/validate.ts';

export interface TemplateArtifact {
  slug: string; // e.g. primary-desktop
  template: string;
  viewport: string;
  pageId: string;
  libPath: string;
  lib: PenDocument;
  libValidation: ValidationResult;
  previewPath: string;
  preview: PenDocument;
  previewValidation: ValidationResult;
  imports: string[];
}

export function emitTemplates(_tokens: TokenSet): TemplateArtifact[] {
  const compCtx = multiAliasBuildContext();
  const mockCtx = multiAliasContext();
  const specsById = new Map(heroUIComponents().map((s) => [s.id, s]));
  const arts: TemplateArtifact[] = [];

  for (const t of PAGE_TEMPLATES) {
    const localSpecs = t.uses.map((id) => specsById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    for (const vp of VIEWPORTS) {
      const slug = `${t.id}-${vp.id}`;
      const page = reusable(t.build(mockCtx, vp));
      const pageId = (page as Child & { id: string }).id;
      const localComps = localSpecs.map((s) => s.build(compCtx));
      const imports = aliasesReferenced(JSON.stringify([...localComps, page]));

      const compsFrame = (): Child =>
        frame(`tpl-${slug}-components`, {
          name: 'Components', x: 1600, y: 0, layout: 'vertical', gap: 24, padding: 32,
          fill: '$colors:color.background',
        }, structuredClone(localComps));

      const assemble = (pageNode: Child): PenDocument => {
        const d = new PenDocument();
        for (const a of imports) {
          const sl = slugForAlias(a);
          if (sl) d.importLib(a, `../foundations/${sl}.lib.pen`);
        }
        d.add(compsFrame());
        const p = pageNode as Child & { x?: number; y?: number };
        p.x = 0;
        p.y = 0;
        d.add(pageNode);
        return d;
      };

      const lib = assemble(page);
      const preview = assemble(structuredClone(page));

      arts.push({
        slug,
        template: t.id,
        viewport: vp.id,
        pageId,
        libPath: `templates/${slug}.lib.pen`,
        lib,
        libValidation: validateDocument(lib.toObject()),
        previewPath: `templates/${slug}.preview.pen`,
        preview,
        previewValidation: validateDocument(preview.toObject()),
        imports,
      });
    }
  }

  return arts;
}