/**
 * `mech-pencil theme` — generate a single `.pen` design system from
 * the HeroUI Themes builder knobs (accent / base / font / radius /
 * form-radius). Same component catalog + mockups as `init`, but the
 * token palette is computed by the HeroUI `generateThemeColors` port.
 */

import { resolve } from 'node:path';
import { emitDocument } from '../emit/document.ts';
import type { FrameworkAdapter } from '../frameworks/adapter.ts';
import { heroUIAdapter } from '../frameworks/heroui/index.ts';
import { documentPath, writeText } from '../lib/workspace.ts';
import { type ThemeConfig, resolveTheme } from '../theme/config.ts';
import { themeTokens } from '../theme/generate.ts';
import { dim, err, heading, ok, warn } from '../ui.ts';

export interface ThemeCmdOptions {
  accent?: string;
  base?: string;
  font?: string;
  radius?: string;
  formRadius?: string;
  dir: string;
  name?: string;
}

/** A HeroUI adapter whose tokens are the themed palette. */
function themedAdapter(cfg: ThemeConfig): FrameworkAdapter {
  return {
    id: 'heroui',
    title: 'HeroUI v3 (themed)',
    description: 'HeroUI v3 with a generated theme palette.',
    reference: 'https://heroui.com/themes',
    tokens: () => themeTokens(cfg).tokens,
    components: () => heroUIAdapter.components(),
    mockups: () => heroUIAdapter.mockups?.() ?? [],
    notes: () => heroUIAdapter.notes?.() ?? [],
  };
}

export function runTheme(options: ThemeCmdOptions): void {
  let cfg: ThemeConfig;
  try {
    cfg = resolveTheme({
      accent: options.accent,
      base: options.base !== undefined ? Number(options.base) : undefined,
      fontFamily: options.font,
      radius: options.radius as ThemeConfig['radius'] | undefined,
      formRadius: options.formRadius as ThemeConfig['formRadius'] | undefined,
    });
  } catch (e) {
    console.error(err((e as Error).message));
    process.exitCode = 1;
    return;
  }

  const adapter = themedAdapter(cfg);
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

  console.log(heading('HeroUI v3 themed → Pencil document'));
  console.log(ok(file));
  console.log(
    dim(
      `  accent ${cfg.accent} · base ${cfg.base} · ${cfg.fontFamily} · radius ${cfg.radius} · form ${cfg.formRadius}`,
    ),
  );
  console.log(
    dim(`  ${variableKeys.length} tokens · ${componentIds.length} components · screen: ${screenSlugs.join(', ')}`),
  );
  for (const note of adapter.notes?.() ?? []) console.log(warn(note));
}
