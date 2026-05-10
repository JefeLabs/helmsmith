/**
 * agentx-specific theme integration.
 *
 * Directory layout:
 *
 *   ~/.agentx/theme/
 *   ├── default.{yaml,yml,json}        ← the active default theme
 *   └── <appName>.{yaml,yml,json}      ← optional per-app overrides
 *
 * Resolution layers (each deep-merged onto the previous):
 *
 *   1. Built-in fallback Theme           (e.g. rosePine)
 *   2. ~/.agentx/theme/default.*         (full theme, replaces #1)
 *   3. ~/.agentx/theme/<appName>.*       (partial override, deep-merged)
 *
 * The default file is the single source of truth for the user's
 * choice. When the in-app theme switcher selects a different theme,
 * it overwrites this file. Hand-edited defaults survive across runs
 * because nothing else writes to them.
 */

import {
  copyFileSync,
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  unlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { applyOverrideFile, loadThemeFile } from './base16.ts';
import { rosePine } from './themes/rose-pine.ts';
import type { Theme } from './types.ts';

const SUPPORTED_EXTS = ['.yaml', '.yml', '.json'] as const;
type SupportedExt = (typeof SUPPORTED_EXTS)[number];

export const DEFAULT_FILE_BASENAME = 'default';

/** `~/.agentx/theme` — overridable for tests via `AGENTX_THEME_DIR`. */
export function agentxThemeDir(): string {
  return process.env.AGENTX_THEME_DIR ?? join(homedir(), '.agentx', 'theme');
}

/**
 * Find an existing file by basename, trying YAML then JSON. Returns
 * the matching path or null.
 */
export function findThemeFile(
  dir: string,
  basename: string,
): { path: string; ext: SupportedExt } | null {
  for (const ext of SUPPORTED_EXTS) {
    const p = join(dir, basename + ext);
    if (existsSync(p)) return { path: p, ext };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Loading
// ────────────────────────────────────────────────────────────────────

export interface AgentxLoadOptions {
  /** App identifier. When set, `<appName>.{yaml,json}` overrides apply. */
  appName?: string;
  /** Theme used when no `default.*` file exists. */
  fallback?: Theme;
  /** Override the directory (mostly for tests). */
  themeDir?: string;
}

export interface AgentxLoadResult {
  theme: Theme;
  /** Source paths that contributed to the resolved theme. */
  sources: string[];
}

/**
 * Resolve the effective theme for an agentx app:
 *   fallback → default.* → <appName>.*
 */
export function loadAgentxTheme(opts: AgentxLoadOptions = {}): AgentxLoadResult {
  const dir = opts.themeDir ?? agentxThemeDir();
  const fallback = opts.fallback ?? rosePine;
  const sources: string[] = [];

  let theme: Theme = fallback;

  // Layer 2: default
  const defaultFile = findThemeFile(dir, DEFAULT_FILE_BASENAME);
  if (defaultFile) {
    try {
      theme = loadThemeFile(defaultFile.path);
      sources.push(defaultFile.path);
    } catch (err) {
      console.warn(`[agentx-theme] Could not load ${defaultFile.path}: ${(err as Error).message}`);
    }
  }

  // Layer 3: app-specific override
  if (opts.appName) {
    const appFile = findThemeFile(dir, opts.appName);
    if (appFile) {
      try {
        theme = applyOverrideFile(theme, appFile.path);
        sources.push(appFile.path);
      } catch (err) {
        console.warn(`[agentx-theme] Could not apply ${appFile.path}: ${(err as Error).message}`);
      }
    }
  }

  return { theme, sources };
}

// ────────────────────────────────────────────────────────────────────
// Persistence — overwrite the default file with a new theme
// ────────────────────────────────────────────────────────────────────

/**
 * Serialize a Theme to JSON suitable for `default.json`. Everything
 * round-trips through `loadThemeFile()` so the saved theme will
 * reload identically on next startup.
 *
 * We always write JSON (rather than trying to round-trip YAML
 * comments etc.). If a `default.yaml` exists we leave it alone and
 * write `default.json` alongside, which `findThemeFile()` would
 * prefer YAML over — so we delete the YAML when persisting. This
 * keeps the "default file IS the choice" invariant.
 */
export interface PersistAgentxThemeOptions {
  themeDir?: string;
}

export function persistAgentxTheme(theme: Theme, opts: PersistAgentxThemeOptions = {}): void {
  const dir = opts.themeDir ?? agentxThemeDir();
  try {
    mkdirSync(dir, { recursive: true });

    const target = join(dir, `${DEFAULT_FILE_BASENAME}.json`);
    const definition = themeToDefinition(theme);
    writeFileSync(target, `${JSON.stringify(definition, null, 2)}\n`, 'utf8');

    // If there's a YAML default sitting alongside, neutralize it so
    // the JSON we just wrote wins on next load.
    for (const ext of ['.yaml', '.yml'] as const) {
      const stale = join(dir, `${DEFAULT_FILE_BASENAME}${ext}`);
      if (existsSync(stale)) {
        try {
          // Back up rather than delete outright, so users keep their work.
          copyFileSync(stale, join(dir, `${DEFAULT_FILE_BASENAME}${ext}.bak`));
          unlinkSync(stale);
        } catch {
          /* best effort */
        }
      }
    }
  } catch (err) {
    console.warn(`[agentx-theme] Could not persist theme: ${(err as Error).message}`);
  }
}

/**
 * Reverse of `loadThemeFile()` for the rich format: produce a
 * minimal ThemeDefinition that round-trips. We store the resolved
 * `colors`/`components`/`spacing`/`typography` under `overrides` so
 * any token touched by a theme author is preserved verbatim.
 */
function themeToDefinition(theme: Theme): Record<string, unknown> {
  return {
    name: theme.name,
    displayName: theme.displayName,
    appearance: theme.appearance,
    palette: theme.colors.palette,
    overrides: {
      colors: stripPaletteAndSyntax(theme.colors),
      // Spacing/borders/typography/components could differ from the
      // defaults computed from the palette, so we round-trip them too.
      spacing: theme.spacing,
      borders: theme.borders,
      typography: theme.typography,
      components: theme.components,
    },
  };
}

function stripPaletteAndSyntax(colors: Theme['colors']): Record<string, unknown> {
  const { palette: _p, syntax, ...rest } = colors;
  return { ...rest, syntax };
}

// ────────────────────────────────────────────────────────────────────
// Watching
// ────────────────────────────────────────────────────────────────────

export interface WatchAgentxOptions extends AgentxLoadOptions {
  debounceMs?: number;
}

/**
 * Watch the agentx theme directory. Whenever a relevant file changes
 * (default.* or <appName>.*), the callback fires with the freshly
 * resolved theme.
 */
export function watchAgentxTheme(
  opts: WatchAgentxOptions,
  onChange: (result: AgentxLoadResult) => void,
): () => void {
  const dir = opts.themeDir ?? agentxThemeDir();
  const debounceMs = opts.debounceMs ?? 100;

  // Make sure the directory exists so fs.watch doesn't throw.
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* permission errors etc. — bail silently below */
  }
  if (!existsSync(dir)) return () => {};

  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  const reload = (filename: string | null) => {
    if (filename) {
      const ext = extname(filename).toLowerCase();
      if (!SUPPORTED_EXTS.includes(ext as SupportedExt)) return;
      const stem = filename.slice(0, -ext.length);
      if (stem !== DEFAULT_FILE_BASENAME && stem !== opts.appName) return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        onChange(loadAgentxTheme(opts));
      } catch (err) {
        console.warn(`[agentx-theme] Reload failed: ${(err as Error).message}`);
      }
    }, debounceMs);
  };

  try {
    watcher = watch(dir, { recursive: false }, (_event, filename) => {
      reload(filename ? String(filename) : null);
    });
  } catch (err) {
    console.warn(`[agentx-theme] Could not watch ${dir}: ${(err as Error).message}`);
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

// ────────────────────────────────────────────────────────────────────
// Discovery — list all theme files in the directory (for pickers)
// ────────────────────────────────────────────────────────────────────

export interface DiscoveredFile {
  basename: string; // e.g. "default" or "myapp"
  path: string;
  ext: SupportedExt;
}

/**
 * List every YAML/JSON file in the agentx theme dir. Useful if you
 * want to surface all customizations in a debug panel.
 */
export function listAgentxThemeFiles(themeDir?: string): DiscoveredFile[] {
  const dir = themeDir ?? agentxThemeDir();
  if (!existsSync(dir)) return [];
  const out: DiscoveredFile[] = [];
  for (const entry of readdirSync(dir)) {
    const ext = extname(entry).toLowerCase();
    if (!SUPPORTED_EXTS.includes(ext as SupportedExt)) continue;
    const basename = entry.slice(0, -ext.length);
    out.push({ basename, path: join(dir, entry), ext: ext as SupportedExt });
  }
  return out;
}
