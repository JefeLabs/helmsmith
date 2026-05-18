/**
 * The mech-pencil **manifest** — the compact, deterministic index an
 * agent (or the `pencil-skill-router` Skill) consults instead of
 * loading the ~40-file generated library into context.
 *
 * For each of the 71 components it records: the slug id, canonical
 * React export + package, atomic level, HeroUI category, the
 * customizable descendant surface (what a `descendants` patch can
 * touch), and the token keys it references. Plus the global token
 * contract and — load-bearing — the verified Pencil constraints (the
 * negative knowledge that costs the most to rediscover).
 */

import { defaultBuildContext } from '../design-system/atomic.ts';
import { HEROUI_PACKAGE, heroUIComponents } from '../frameworks/heroui/catalog.ts';
import { PEN_VERSION } from '../pen/schema.ts';
import type { Child } from '../pen/schema.ts';
import { resolveTheme } from '../theme/config.ts';
import { themeTokens } from '../theme/generate.ts';

export interface ManifestPart {
  /** Descendant id — use as a `descendants` key on a LOCAL ref. */
  id: string;
  type: string;
  /** Props a `descendants` patch on this part can meaningfully set. */
  overrides: string[];
}

export interface ManifestComponent {
  id: string;
  react: string;
  package: string;
  atomic: string;
  category: string;
  /** Customizable descendants (LOCAL refs only — see constraints). */
  customizable: ManifestPart[];
  /** Token keys this component binds to. */
  tokens: string[];
}

export interface ManifestToken {
  key: string;
  type: 'color' | 'number' | 'string';
}

export interface Manifest {
  framework: string;
  pencilVersion: string;
  package: string;
  componentCount: number;
  /** Props settable directly on a `ref` — the ONLY overrides that
   * cross files; everything else must be a LOCAL ref. */
  rootOverrides: string[];
  components: ManifestComponent[];
  tokens: ManifestToken[];
  /** Verified Pencil behaviour an agent MUST respect. */
  constraints: string[];
  /** What each CLI verb produces (routing aid). */
  commands: Record<string, string>;
}

function tokenRefsIn(node: Child): Set<string> {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.startsWith('$')) {
        const ref = v.slice(1);
        out.add(ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v && typeof v === 'object') for (const x of Object.values(v)) visit(x);
  };
  visit(node);
  return out;
}

function partsOf(root: Child): ManifestPart[] {
  const parts: ManifestPart[] = [];
  const walk = (n: Child): void => {
    if (n.id !== root.id) {
      const t = (n as { type: string }).type;
      const overrides =
        t === 'text'
          ? ['content', 'fill']
          : t === 'frame' && (n as { slot?: unknown }).slot
            ? ['children']
            : t === 'frame'
              ? ['fill']
              : [];
      if (overrides.length > 0) parts.push({ id: n.id, type: t, overrides });
    }
    if ('children' in n && Array.isArray(n.children)) {
      for (const c of n.children) walk(c);
    }
  };
  walk(root);
  return parts;
}

export function buildManifest(): Manifest {
  const components: ManifestComponent[] = heroUIComponents().map((spec) => {
    const node = spec.build(defaultBuildContext);
    return {
      id: spec.id,
      react: spec.name,
      package: HEROUI_PACKAGE,
      atomic: spec.level,
      category: spec.category,
      customizable: partsOf(node),
      tokens: [...tokenRefsIn(node)].sort(),
    };
  });

  const t = themeTokens(resolveTheme({})).tokens;
  const tokens: ManifestToken[] = [
    ...t.colors.map((c) => ({ key: c.key, type: 'color' as const })),
    ...t.scalars.map((s) => ({ key: s.key, type: s.type })),
  ];

  return {
    framework: 'heroui',
    pencilVersion: PEN_VERSION,
    package: HEROUI_PACKAGE,
    componentCount: components.length,
    rootOverrides: ['fill', 'stroke', 'opacity', 'x', 'y', 'width', 'height'],
    components,
    tokens,
    constraints: [
      "Node `id` must NOT contain '/' — the slash is the descendants path separator.",
      'Cross-file component `descendants` overrides (property AND slot/children) are silently dropped. To customize an instance it must be a LOCAL ref in the same file — generated mocks embed local component copies for exactly this reason.',
      "Only root-level props on a `ref` cross files. The cross-file ref delimiter is ':' (alias:componentId).",
      'Cross-file VARIABLES DO resolve via `$alias:key` — this is how theming flows from the imported token file.',
      'A `.lib.pen` opened standalone does NOT resolve its own imports (renders unthemed). Open the matching `.preview.pen` (a regular `.pen`) to view themed.',
      `Schema is pinned to v${PEN_VERSION}; Pencil's .pen format is explicitly unstable.`,
    ],
    commands: {
      bundle:
        'Themed layered system: design-tokens.lib.pen + core/<category>.{lib,preview}.pen + design-system/<level>.{lib,preview}.pen + mocks/template.pen (full local palette). Reuses the committed library; only design-tokens.lib.pen is per-project.',
      theme: 'One self-contained themed .pen (all 71 components local + a screen).',
      brand: 'Two files: swappable design-tokens.lib.pen + design.pen importing it.',
      init: 'Single static-default-theme .pen.',
      'build-library': 'MAINTAINER: regenerate the committed HeroUI library.',
      manifest: 'Emit this manifest JSON.',
      list: 'List frameworks / a framework’s catalog.',
      validate: 'Structurally validate a .pen (v2.11 rules).',
    },
  };
}
