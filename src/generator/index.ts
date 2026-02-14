import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { registerHelpers } from './helpers.js';

// Re-export types
export type {
  TaskListContext,
  TaskDetailContext,
  ComplexityReportContext,
  ProgressReportContext,
  DependencyGraphContext,
} from './types.js';

// --- State ---

let initialized = false;
let projectPath: string | null = null;
const templateCache = new Map<string, HandlebarsTemplateDelegate>();

/**
 * Resolve the built-in templates directory.
 * Works from:
 *   - src/generator/index.ts  (dev via vitest/tsx)
 *   - dist/cli.js             (tsup bundle)
 *   - dist/generator/index.js (non-bundled compile)
 */
function getBuiltinTemplatesDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = join(currentFile, '..');

  const candidates = [
    // Dev: src/generator/index.ts -> src/templates/
    join(currentDir, '..', 'templates'),
    // Bundled: dist/cli.js -> <root>/src/templates/
    join(currentDir, '..', 'src', 'templates'),
    // Non-bundled dist: dist/generator/index.js -> <root>/src/templates/
    join(currentDir, '..', '..', 'src', 'templates'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Built-in templates directory not found. Searched:\n${candidates.map(c => `  - ${c}`).join('\n')}`,
  );
}

/**
 * Set the active project path for template override resolution.
 * Call this before rendering templates that may have user overrides.
 */
export function setProjectPath(path: string): void {
  projectPath = path;
  // Clear cache when project changes so overrides are re-resolved
  templateCache.clear();
  initialized = false;
}

/**
 * Initialize the engine: register helpers and auto-discover partials.
 * Called lazily on first render.
 */
function initEngine(): void {
  if (initialized) return;

  registerHelpers();
  registerPartials();
  initialized = true;
}

/**
 * Auto-discover and register all .hbs files from the partials directory.
 * Filename without extension becomes the partial name.
 * User project partials override built-in ones.
 */
function registerPartials(): void {
  const builtinDir = getBuiltinTemplatesDir();
  const builtinPartialsDir = join(builtinDir, 'partials');

  // Register built-in partials first
  if (existsSync(builtinPartialsDir)) {
    registerPartialsFromDir(builtinPartialsDir);
  }

  // Override with user project partials if available
  if (projectPath) {
    const projectPartialsDir = join(projectPath, 'templates', 'partials');
    if (existsSync(projectPartialsDir)) {
      registerPartialsFromDir(projectPartialsDir);
    }
  }
}

function registerPartialsFromDir(dir: string): void {
  const files = readdirSync(dir);
  for (const file of files) {
    if (extname(file) !== '.hbs') continue;
    const name = basename(file, '.hbs');
    const content = readFileSync(join(dir, file), 'utf-8');
    Handlebars.registerPartial(name, content);
  }
}

/**
 * Resolve a template name to its file path.
 * Order: (1) project templates dir, (2) built-in src/templates/.
 */
function resolveTemplatePath(templateName: string): string {
  const filename = templateName.endsWith('.hbs') ? templateName : `${templateName}.hbs`;

  // Check project override first
  if (projectPath) {
    const projectTemplatePath = join(projectPath, 'templates', filename);
    if (existsSync(projectTemplatePath)) {
      return projectTemplatePath;
    }
  }

  // Fall back to built-in
  const builtinDir = getBuiltinTemplatesDir();
  const builtinPath = join(builtinDir, filename);
  if (existsSync(builtinPath)) {
    return builtinPath;
  }

  throw new Error(
    `Template "${templateName}" not found.` +
      (projectPath
        ? ` Searched: ${join(projectPath, 'templates', filename)}, ${builtinPath}`
        : ` Searched: ${builtinPath}`),
  );
}

/**
 * Compile a template by name. Caches compiled templates in memory.
 */
export function compileTemplate(templateName: string): HandlebarsTemplateDelegate {
  initEngine();

  const cached = templateCache.get(templateName);
  if (cached) return cached;

  const templatePath = resolveTemplatePath(templateName);
  const source = readFileSync(templatePath, 'utf-8');
  const compiled = Handlebars.compile(source, {
    noEscape: true, // Templates produce markdown, not HTML — don't escape
  });

  templateCache.set(templateName, compiled);
  return compiled;
}

/**
 * Render a template to a markdown string.
 */
export function renderToMarkdown(
  templateName: string,
  context: Record<string, unknown>,
): string {
  const template = compileTemplate(templateName);
  return template(context, {
    allowProtoPropertiesByDefault: true,
    allowProtoMethodsByDefault: true,
  });
}

/**
 * Render a template to ANSI terminal output via marked + marked-terminal.
 */
export function renderToTerminal(
  templateName: string,
  context: Record<string, unknown>,
): string {
  const markdown = renderToMarkdown(templateName, context);
  return markdownToTerminal(markdown);
}

/**
 * Convert a markdown string to ANSI-styled terminal output.
 */
function markdownToTerminal(markdown: string): string {
  marked.use(markedTerminal({ tab: 2 }) as Record<string, unknown>);
  const result = marked.parse(markdown);
  // marked.parse can return string | Promise<string>; we use sync mode
  if (typeof result === 'string') {
    return result;
  }
  // Should not happen in sync mode, but handle gracefully
  return markdown;
}

/**
 * Reset engine state. Useful for testing.
 */
export function resetEngine(): void {
  initialized = false;
  projectPath = null;
  templateCache.clear();
}
