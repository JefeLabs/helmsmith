/**
 * Layered bundle emit (the user-specified topology):
 *
 *   theme.lib.pen            LAYER 1  variables only (swappable)
 *   groups/<cat>.lib.pen ×N  LAYER 2  HeroUI category libs — import
 *                                     theme; LAYER 3 atomic-ordered
 *                                     reusable components inside
 *   mocks/<slug>.pen         LAYER 4  imports theme; LOCAL copies of
 *                                     only the components the mock
 *                                     uses (atomic-ordered) + screen
 *
 * Cross-file rule (empirically verified this session): only THEME
 * (variables) is safely importable — an importer's own component
 * nodes resolve `$theme:var`. Component `descendants` overrides do NOT
 * cross files, so the mock keeps local component copies (the only
 * Test-B-safe way to stay customizable).
 */

import type { BuildContext, ComponentSpec } from '../design-system/atomic.ts';
import { ATOMIC_ORDER } from '../design-system/atomic.ts';
import type { TokenSet } from '../design-system/tokens.ts';
import { CATEGORY_ORDER, heroUIComponents } from '../frameworks/heroui/catalog.ts';
import { heroUIAdapter } from '../frameworks/heroui/index.ts';
import { frame, text } from '../pen/builder.ts';
import { PenDocument } from '../pen/document.ts';
import type { Child } from '../pen/schema.ts';
import { type ValidationResult, validateDocument } from '../pen/validate.ts';
import type { ThemeConfig } from '../theme/config.ts';
import { themeTokens } from '../theme/generate.ts';

// The token layer's import alias + filename. Refs are `$tokens:<key>`;
// the file is `design-tokens.lib.pen` (internal identifiers below
// still say "brand" — the doc this app produces — but the emitted
// alias/filename are the user-facing names).
const ALIAS = 'tokens';
const BRAND_FILE = 'design-tokens.lib.pen';
/** Relative path back to design-tokens.lib.pen (root vs subdir files). */
const relBrand = (subdir: boolean) => `${subdir ? '..' : '.'}/${BRAND_FILE}`;

const ctxFor = (alias: string): BuildContext => ({
  color: (n) => `$${alias}:color.${n}`,
  token: (k) => `$${alias}:${k}`,
});

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function tokensDoc(t: TokenSet): PenDocument {
  const d = new PenDocument();
  for (const { axis, values } of t.axes) d.axis(axis, values);
  for (const c of t.colors)
    d.variable(c.key, {
      type: 'color',
      value: [
        { value: c.values.light, theme: { mode: 'light' } },
        { value: c.values.dark, theme: { mode: 'dark' } },
      ],
    });
  for (const s of t.scalars)
    d.variable(
      s.key,
      s.type === 'number'
        ? { type: 'number', value: s.value as number }
        : { type: 'string', value: s.value as string },
    );
  return d;
}

const headingNode = (id: string, s: string, big = true): Child =>
  text(id, s, {
    fill: `$${ALIAS}:color.${big ? 'foreground' : 'muted'}`,
    fontFamily: `$${ALIAS}:font.family`,
    fontSize: big ? 24 : 13,
    fontWeight: big ? '700' : '600',
  });

/**
 * LAYER 3: components grouped into atom→molecule→organism sections.
 * `sourceFor` stamps each component's provenance chain into
 * `metadata.source` (brand → group → design-system → …) so the
 * layering is explicit and tooling-traceable even though Pencil
 * resolves the component locally.
 */
function atomicSections(
  prefix: string,
  specs: ComponentSpec[],
  ctx: BuildContext,
  sourceFor?: (s: ComponentSpec) => string[],
): Child[] {
  const out: Child[] = [];
  for (const lvl of ATOMIC_ORDER) {
    const inLvl = specs.filter((s) => s.level === lvl);
    if (inLvl.length === 0) continue;
    out.push(
      frame(
        `${prefix}-${lvl}`,
        { name: `${lvl}s`, layout: 'vertical', width: 'fit_content', gap: 16 },
        [
          headingNode(`${prefix}-${lvl}-h`, `${lvl}s`.toUpperCase(), false),
          frame(
            `${prefix}-${lvl}-items`,
            { name: 'Items', layout: 'vertical', width: 'fit_content', gap: 16 },
            inLvl.map((s) => {
              const node = s.build(ctx);
              if (sourceFor) {
                node.metadata = {
                  type: 'component',
                  ...node.metadata,
                  source: sourceFor(s),
                };
              }
              return node;
            }),
          ),
        ],
      ),
    );
  }
  return out;
}

/** Collect bare (local) ref targets in a node tree incl. descendants. */
function collectRefs(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.type === 'ref' && typeof n.ref === 'string' && !/[:/]/.test(n.ref)) {
    into.add(n.ref);
  }
  for (const c of (n.children as unknown[] | undefined) ?? []) collectRefs(c, into);
  if (n.descendants && typeof n.descendants === 'object') {
    for (const patch of Object.values(n.descendants as Record<string, unknown>)) {
      const kids = (patch as { children?: unknown[] })?.children;
      if (Array.isArray(kids)) for (const c of kids) collectRefs(c, into);
    }
  }
}

export interface BundleFile {
  path: string; // relative to bundle root
  doc: PenDocument;
  validation: ValidationResult;
}

export interface EmittedBundle {
  /** LAYER 1 — variables only; the swappable brand/token source. */
  brand: BundleFile;
  /** LAYER 3 — `.lib.pen` aggregate of all components, atomic-organized,
   * imports brand (import-only) + a `.preview.pen` twin (regular
   * `.pen`, themes standalone — the browse-everything file). Custom
   * components added to the catalog flow into both automatically. */
  designSystem: BundleFile & { preview: BundleFile };
  /** LAYER 2 — one `.lib.pen` per HeroUI category (import-only) plus a
   * `.preview.pen` viewable twin (regular `.pen`, themes standalone). */
  groups: (BundleFile & {
    category: string;
    count: number;
    preview: BundleFile;
  })[];
  /** LAYER 4 — imports brand; local components carrying `metadata.source`
   * lineage; customizable. */
  mocks: (BundleFile & { name: string; components: string[] })[];
}

export function emitBundle(cfg: ThemeConfig): EmittedBundle {
  const tokens = themeTokens(cfg).tokens;
  const ctx = ctxFor(ALIAS);
  const specs = heroUIComponents();

  const brandDoc = tokensDoc(tokens);
  const brand: BundleFile = {
    path: BRAND_FILE,
    doc: brandDoc,
    validation: validateDocument(brandDoc.toObject()),
  };

  // Provenance chains (metadata.source) up the layering.
  const groupFile = (s: ComponentSpec) => `groups/${slugify(s.category)}.lib.pen`;
  const groupSource = (s: ComponentSpec) => [BRAND_FILE, groupFile(s)];
  const dsSource = (s: ComponentSpec) => [
    BRAND_FILE,
    groupFile(s),
    'design-system.lib.pen',
  ];

  // LAYER 2: one .lib.pen per HeroUI category, atomic-ordered inside.
  const groups: EmittedBundle['groups'] = [];
  for (const category of CATEGORY_ORDER) {
    const inCat = specs.filter((s) => s.category === category);
    if (inCat.length === 0) continue;
    const slug = slugify(category);
    const groupFrame = frame(
      `group-${slug}`,
      {
        name: category,
        x: 0,
        y: 0,
        layout: 'vertical',
        gap: 40,
        padding: 40,
        fill: `$${ALIAS}:color.background`,
      },
      [
        headingNode(`group-${slug}-title`, `${category} · HeroUI v3`),
        ...atomicSections(`g-${slug}`, inCat, ctx, groupSource),
      ],
    );

    // The import-only library artifact.
    const lib = new PenDocument().importLib(ALIAS, relBrand(true));
    lib.add(groupFrame);

    // A viewable twin: a regular `.pen` with identical content — opens
    // themed standalone (a `.lib.pen` does not resolve its own imports;
    // a `.pen` does — verified).
    const preview = new PenDocument().importLib(ALIAS, relBrand(true));
    preview.add(structuredClone(groupFrame));

    groups.push({
      path: `groups/${slug}.lib.pen`,
      category,
      count: inCat.length,
      doc: lib,
      validation: validateDocument(lib.toObject()),
      preview: {
        path: `groups/${slug}.preview.pen`,
        doc: preview,
        validation: validateDocument(preview.toObject()),
      },
    });
  }

  // The category → atomic section tree, shared by the importable
  // design-system.lib.pen and its design-system.preview.pen twin.
  const dsSections = (): Child[] => {
    const sections: Child[] = [];
    for (const category of CATEGORY_ORDER) {
      const inCat = specs.filter((s) => s.category === category);
      if (inCat.length === 0) continue;
      const cslug = slugify(category);
      sections.push(
        frame(
          `cat-${cslug}`,
          { name: category, layout: 'vertical', width: 'fit_content', gap: 24 },
          [
            headingNode(`cat-${cslug}-h`, category),
            ...atomicSections(`c-${cslug}`, inCat, ctx, dsSource),
          ],
        ),
      );
    }
    return sections;
  };
  const dsRoot = (): Child =>
    frame(
      'design-system',
      {
        name: 'Design System',
        x: 0,
        y: 0,
        layout: 'vertical',
        gap: 56,
        padding: 48,
        fill: `$${ALIAS}:color.background`,
      },
      [
        headingNode('ds-title', `HeroUI v3 · ${specs.length} components`),
        ...dsSections(),
      ],
    );

  // LAYER 3: design-system.lib.pen (import-only aggregate) + a
  // .preview.pen twin (regular `.pen` → themes standalone; the
  // browse-everything file). Custom components added to the catalog
  // flow into both automatically.
  const dsLib = new PenDocument().importLib(ALIAS, relBrand(false));
  dsLib.add(dsRoot());
  const dsPrev = new PenDocument().importLib(ALIAS, relBrand(false));
  dsPrev.add(dsRoot()); // fresh tree (dsRoot builds new nodes each call)
  const designSystem: EmittedBundle['designSystem'] = {
    path: 'design-system.lib.pen',
    doc: dsLib,
    validation: validateDocument(dsLib.toObject()),
    preview: {
      path: 'design-system.preview.pen',
      doc: dsPrev,
      validation: validateDocument(dsPrev.toObject()),
    },
  };

  // LAYER 4: each mock — local copies of only the components it uses.
  const byId = new Map(specs.map((s) => [s.id, s]));
  const mocks: EmittedBundle['mocks'] = [];
  for (const spec of heroUIAdapter.mockups?.() ?? []) {
    const screenNodes = spec.build({
      component: (id) => id,
      token: (k) => `$${ALIAS}:${k}`,
    });

    const used = new Set<string>();
    for (const n of screenNodes) collectRefs(n, used);
    const usedSpecs = [...used]
      .map((id) => byId.get(id))
      .filter((s): s is ComponentSpec => Boolean(s));

    const mockSource = (s: ComponentSpec) => [
      ...dsSource(s),
      `mocks/${spec.slug}.pen`,
    ];
    const d = new PenDocument().importLib(ALIAS, relBrand(true));
    d.add(
      frame(
        `mock-${spec.slug}-components`,
        {
          name: 'Components',
          x: 1500,
          y: 0,
          layout: 'vertical',
          gap: 40,
          padding: 40,
          fill: `$${ALIAS}:color.background`,
        },
        [
          headingNode(`mock-${spec.slug}-ctitle`, 'Components (local — customizable)'),
          ...atomicSections(`m-${spec.slug}`, usedSpecs, ctx, mockSource),
        ],
      ),
    );
    let cursorY = 0;
    for (const node of screenNodes) {
      const p = node as Child & { x?: number; y?: number; height?: unknown };
      p.x = 0;
      p.y = cursorY;
      cursorY += (typeof p.height === 'number' ? p.height : 900) + 96;
      d.add(node);
    }

    mocks.push({
      path: `mocks/${spec.slug}.pen`,
      name: spec.name,
      components: [...used],
      doc: d,
      validation: validateDocument(d.toObject()),
    });
  }

  return { brand, designSystem, groups, mocks };
}
