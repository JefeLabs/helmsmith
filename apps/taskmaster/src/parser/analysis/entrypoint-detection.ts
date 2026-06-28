import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
  BuildComponent,
  EnhancedFileAnalysis,
  EntryPoint,
  EntryPointCategory,
} from './types.js';

/**
 * AST pattern rules keyed by entry point category.
 * Each rule has regex patterns matched against source text and symbol tags.
 */
interface DetectionRule {
  category: EntryPointCategory;
  /** Regex patterns matched against source code lines */
  sourcePatterns: RegExp[];
  /** Symbol tags from enhanced analysis that indicate this category */
  symbolTags: string[];
  /** Symbol kinds from enhanced analysis that indicate this category */
  symbolKinds: string[];
  /** File path patterns that suggest this category */
  pathPatterns: RegExp[];
  /** Base confidence for static detection */
  confidence: number;
}

const DETECTION_RULES: DetectionRule[] = [
  {
    category: 'http-api',
    sourcePatterns: [
      /\bapp\.(get|post|put|patch|delete|options|head|all)\s*\(/i,
      /\brouter\.(get|post|put|patch|delete|options|head|all)\s*\(/i,
      /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(/,
      /\bhttp\.HandleFunc\s*\(/,
      /\bhttp\.Handle\s*\(/,
      /\bfastify\.(get|post|put|patch|delete)\s*\(/i,
      /\bhono\.(get|post|put|patch|delete)\s*\(/i,
    ],
    symbolTags: ['kind:route', 'cap:http'],
    symbolKinds: ['route'],
    pathPatterns: [/\broutes?\b/i, /\bcontrollers?\b/i, /\bhandlers?\b/i, /\bendpoints?\b/i],
    confidence: 0.9,
  },
  {
    category: 'cli-command',
    sourcePatterns: [
      /\bnew\s+Command\s*\(/,
      /\bprogram\.command\s*\(/,
      /\.addCommand\s*\(/,
      /\bcommander\b.*\.command\s*\(/,
      /\byargs\b.*\.command\s*\(/,
    ],
    symbolTags: ['kind:command'],
    symbolKinds: ['command'],
    pathPatterns: [/\bcli\b/i, /\bbin\b/i, /\bcmd\b/i, /\bcommands?\b/i],
    confidence: 0.9,
  },
  {
    category: 'ui-route',
    sourcePatterns: [
      /<Route\s+path=/,
      /\bcreate(Browser|Memory|Hash)Router\s*\(/,
      /\buseRouter\s*\(/,
      /\bdefinePageMeta\s*\(/,
    ],
    symbolTags: [],
    symbolKinds: [],
    pathPatterns: [/\bpages\b/i, /\bapp\b\/.*\/page\b/i, /\bviews?\b/i],
    confidence: 0.85,
  },
  {
    category: 'event',
    sourcePatterns: [
      /\.subscribe\s*\(/,
      /\.consume\s*\(/,
      /\b@EventPattern\s*\(/,
      /\bchannel\.consume\s*\(/,
      /\.on\s*\(['"`]\w+['"`]/,
      /\b@OnEvent\s*\(/,
      /\bEventEmitter\b/,
    ],
    symbolTags: [],
    symbolKinds: [],
    pathPatterns: [/\bevents?\b/i, /\blisteners?\b/i, /\bsubscribers?\b/i, /\bconsumers?\b/i],
    confidence: 0.7,
  },
  {
    category: 'job-cron',
    sourcePatterns: [
      /\bcron\.schedule\s*\(/,
      /\b@Cron\s*\(/,
      /\b@Scheduled\s*\(/,
      /\.add\s*\([^)]*\{[^}]*repeat\s*:/,
      /\bsetInterval\s*\(/,
      /\bnew\s+CronJob\s*\(/,
    ],
    symbolTags: [],
    symbolKinds: [],
    pathPatterns: [/\bjobs?\b/i, /\bcron\b/i, /\bschedulers?\b/i, /\bworkers?\b/i],
    confidence: 0.75,
  },
  {
    category: 'callback-webhook',
    sourcePatterns: [/['"`]\/webhook/i, /['"`]\/callback/i, /['"`]\/hooks?\//i],
    symbolTags: [],
    symbolKinds: [],
    pathPatterns: [/\bwebhooks?\b/i, /\bcallbacks?\b/i],
    confidence: 0.7,
  },
  {
    category: 'internal-service',
    sourcePatterns: [
      /export\s+(class|function)\s+\w+Service\b/,
      /export\s+default\s+class\s+\w+Service\b/,
    ],
    symbolTags: [],
    symbolKinds: [],
    pathPatterns: [/\bservices?\b/i],
    confidence: 0.5,
  },
];

/**
 * Extract HTTP method and path from a matched source line.
 */
function extractHttpMetadata(line: string): Record<string, string> {
  // Match patterns like: app.post('/api/auth/login', ...)
  const methodMatch = line.match(
    /\b(?:app|router|fastify|hono)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/i,
  );
  if (methodMatch) {
    return { method: methodMatch[1].toUpperCase(), path: methodMatch[2] };
  }

  // Match decorator patterns: @Post('/path')
  const decoratorMatch = line.match(
    /@(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*['"`]([^'"`]+)['"`]/,
  );
  if (decoratorMatch) {
    return { method: decoratorMatch[1].toUpperCase(), path: decoratorMatch[2] };
  }

  return {};
}

/**
 * Extract CLI command name from a matched source line.
 */
function extractCliMetadata(line: string): Record<string, string> {
  const match = line.match(/\.command\s*\(\s*['"`]([^'"`]+)['"`]/);
  if (match) {
    return { commandName: match[1] };
  }
  return {};
}

/**
 * Generate an entry point ID from component and name parts.
 */
function makeEntryPointId(componentId: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  return `ep:${componentId}:${slug}`;
}

/**
 * Detect entry points from enhanced file analysis results using AST-level patterns.
 *
 * Walks the enhanced file results, checks source code against detection rules,
 * and produces categorized EntryPoint objects.
 */
export async function detectEntryPointsFromAST(
  rootPath: string,
  enhancedFiles: EnhancedFileAnalysis[],
  _components: BuildComponent[],
): Promise<EntryPoint[]> {
  const entryPoints: EntryPoint[] = [];
  const seenIds = new Set<string>();

  for (const file of enhancedFiles) {
    const absPath = join(rootPath, file.path);
    let content: string;
    try {
      content = await readFile(absPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const componentId = file.componentId ?? '__root__';

    // Check each rule against this file
    for (const rule of DETECTION_RULES) {
      // Skip internal-service detection for non-service files (too noisy)
      if (rule.category === 'internal-service') {
        const pathMatch = rule.pathPatterns.some((p) => p.test(file.path));
        if (!pathMatch) continue;
      }

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];

        for (const pattern of rule.sourcePatterns) {
          if (!pattern.test(line)) continue;

          // Found a match — build entry point
          let metadata: Record<string, string> = {};
          let name: string;

          if (rule.category === 'http-api') {
            metadata = extractHttpMetadata(line);
            name =
              metadata.method && metadata.path
                ? `${metadata.method} ${metadata.path}`
                : `HTTP handler at ${file.path}:${lineIdx + 1}`;
          } else if (rule.category === 'cli-command') {
            metadata = extractCliMetadata(line);
            name = metadata.commandName
              ? `${metadata.commandName} command`
              : `CLI command at ${file.path}:${lineIdx + 1}`;
          } else if (rule.category === 'callback-webhook') {
            const pathMatch = line.match(/['"`](\/[^'"`]+)['"`]/);
            name = pathMatch ? `Webhook ${pathMatch[1]}` : `Webhook at ${file.path}:${lineIdx + 1}`;
            if (pathMatch) metadata.path = pathMatch[1];
          } else if (rule.category === 'event') {
            const eventMatch = line.match(/['"`](\w[\w.:-]*)['"`]/);
            name = eventMatch
              ? `${eventMatch[1]} listener`
              : `Event listener at ${file.path}:${lineIdx + 1}`;
            if (eventMatch) metadata.eventName = eventMatch[1];
          } else if (rule.category === 'job-cron') {
            const scheduleMatch = line.match(/['"`]([*/\d\s,-]+)['"`]/);
            name = scheduleMatch
              ? `Cron ${scheduleMatch[1].trim()}`
              : `Scheduled job at ${file.path}:${lineIdx + 1}`;
            if (scheduleMatch) metadata.schedule = scheduleMatch[1].trim();
          } else {
            name = `${rule.category} at ${file.path}:${lineIdx + 1}`;
          }

          // Find nearby symbol name
          const symbolName = findNearestSymbol(file, lineIdx + 1);

          const id = makeEntryPointId(componentId, name);
          if (seenIds.has(id)) continue;
          seenIds.add(id);

          entryPoints.push({
            id,
            name,
            category: rule.category,
            componentId,
            filePath: file.path,
            symbolName,
            metadata,
            detectedBy: 'static',
            confidence: rule.confidence,
            tags: [],
          });

          // Only take one match per pattern per line
          break;
        }
      }

      // Also check symbol tags from enhanced analysis
      for (const sym of file.symbols) {
        const tagMatch = rule.symbolTags.some((tag) => sym.tags.includes(tag));
        const kindMatch = rule.symbolKinds.includes(sym.kind);

        if (!tagMatch && !kindMatch) continue;

        const name = `${sym.name} (${rule.category})`;
        const id = makeEntryPointId(componentId, sym.name);
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        entryPoints.push({
          id,
          name,
          category: rule.category,
          componentId,
          filePath: file.path,
          symbolName: sym.name,
          metadata: {},
          detectedBy: 'static',
          confidence: rule.confidence,
          tags: sym.tags.filter((t) => !t.startsWith('kind:') && !t.startsWith('layer:')),
        });
      }
    }
  }

  return entryPoints;
}

/**
 * Find the nearest symbol to a given line number in an enhanced file.
 */
function findNearestSymbol(file: EnhancedFileAnalysis, line: number): string | undefined {
  let closest: { name: string; distance: number } | undefined;

  for (const sym of file.symbols) {
    const symStart = sym.source.range.startLine;
    const symEnd = sym.source.range.endLine;

    // Line is inside this symbol
    if (line >= symStart && line <= symEnd) {
      return sym.name;
    }

    // Track closest preceding symbol
    const distance = Math.abs(line - symStart);
    if (!closest || distance < closest.distance) {
      closest = { name: sym.name, distance };
    }
  }

  return closest && closest.distance <= 5 ? closest.name : undefined;
}

/**
 * Detect entry points from package manifests (package.json bin field, etc.).
 */
export async function detectEntryPointsFromManifest(
  _rootPath: string,
  components: BuildComponent[],
): Promise<EntryPoint[]> {
  const entryPoints: EntryPoint[] = [];
  const seenIds = new Set<string>();

  for (const comp of components) {
    const pkgJsonPath = join(comp.rootPath, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;

    let pkgJson: Record<string, unknown>;
    try {
      const content = await readFile(pkgJsonPath, 'utf-8');
      pkgJson = JSON.parse(content) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Detect bin entries as CLI commands
    const bin = pkgJson.bin;
    if (bin) {
      if (typeof bin === 'string') {
        const name = `${pkgJson.name ?? comp.name} CLI`;
        const id = makeEntryPointId(comp.id, name);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          entryPoints.push({
            id,
            name,
            category: 'cli-command',
            componentId: comp.id,
            filePath: bin,
            metadata: { binName: String(pkgJson.name ?? comp.name) },
            detectedBy: 'manifest',
            confidence: 1.0,
            tags: ['cli', 'manifest'],
          });
        }
      } else if (typeof bin === 'object' && bin !== null) {
        for (const [cmdName, cmdPath] of Object.entries(bin as Record<string, string>)) {
          const name = `${cmdName} CLI`;
          const id = makeEntryPointId(comp.id, cmdName);
          if (seenIds.has(id)) continue;
          seenIds.add(id);

          entryPoints.push({
            id,
            name,
            category: 'cli-command',
            componentId: comp.id,
            filePath: String(cmdPath),
            metadata: { binName: cmdName },
            detectedBy: 'manifest',
            confidence: 1.0,
            tags: ['cli', 'manifest'],
          });
        }
      }
    }

    // Detect scripts that indicate entry points
    const scripts = pkgJson.scripts;
    if (scripts && typeof scripts === 'object') {
      const scriptObj = scripts as Record<string, string>;
      if (scriptObj.start) {
        const name = `${comp.name} start`;
        const id = makeEntryPointId(comp.id, 'start');
        if (!seenIds.has(id)) {
          seenIds.add(id);
          entryPoints.push({
            id,
            name,
            category: 'internal-service',
            componentId: comp.id,
            filePath: String(pkgJson.main ?? pkgJson.module ?? 'index.js'),
            metadata: { script: 'start', command: scriptObj.start },
            detectedBy: 'manifest',
            confidence: 0.7,
            tags: ['manifest'],
          });
        }
      }
    }
  }

  return entryPoints;
}

/**
 * Detect file-based routing conventions (Next.js pages/, app/ directory).
 */
export async function detectFileBasedRoutes(
  rootPath: string,
  components: BuildComponent[],
): Promise<EntryPoint[]> {
  const entryPoints: EntryPoint[] = [];

  // Common file-based routing directories
  const routeDirs = [
    { dir: 'pages', category: 'ui-route' as EntryPointCategory },
    { dir: 'app', category: 'ui-route' as EntryPointCategory },
    { dir: 'src/pages', category: 'ui-route' as EntryPointCategory },
    { dir: 'src/app', category: 'ui-route' as EntryPointCategory },
    { dir: 'src/routes', category: 'ui-route' as EntryPointCategory },
  ];

  for (const { dir, category } of routeDirs) {
    const fullDir = join(rootPath, dir);
    if (!existsSync(fullDir)) continue;

    // Check for Next.js / SvelteKit conventions
    const hasConfig =
      existsSync(join(rootPath, 'next.config.js')) ||
      existsSync(join(rootPath, 'next.config.mjs')) ||
      existsSync(join(rootPath, 'next.config.ts')) ||
      existsSync(join(rootPath, 'svelte.config.js')) ||
      existsSync(join(rootPath, 'nuxt.config.ts'));

    if (!hasConfig && dir !== 'src/routes') continue;

    // Find the owning component
    const comp = components.find(
      (c) => fullDir.startsWith(c.rootPath) || c.rootPath === rootPath,
    ) ?? { id: '__root__' };

    const relDir = relative(rootPath, fullDir);
    const name = `File-based routes (${relDir}/)`;
    const id = makeEntryPointId(comp.id, `file-routes-${dir.replace(/\//g, '-')}`);

    entryPoints.push({
      id,
      name,
      category,
      componentId: comp.id,
      filePath: relDir,
      metadata: { routeDir: dir },
      detectedBy: 'static',
      confidence: 0.85,
      tags: ['file-based-routing'],
    });
  }

  return entryPoints;
}

/**
 * Run all static detection strategies and merge results.
 */
export async function detectEntryPoints(
  rootPath: string,
  enhancedFiles: EnhancedFileAnalysis[],
  components: BuildComponent[],
): Promise<EntryPoint[]> {
  const [astResults, manifestResults, fileRouteResults] = await Promise.all([
    detectEntryPointsFromAST(rootPath, enhancedFiles, components),
    detectEntryPointsFromManifest(rootPath, components),
    detectFileBasedRoutes(rootPath, components),
  ]);

  // Merge and deduplicate by id
  const merged = new Map<string, EntryPoint>();
  for (const ep of [...manifestResults, ...astResults, ...fileRouteResults]) {
    // Manifest results take priority (higher confidence)
    if (!merged.has(ep.id)) {
      merged.set(ep.id, ep);
    }
  }

  return Array.from(merged.values());
}
