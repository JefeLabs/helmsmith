import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, extname, dirname } from 'node:path';
import type {
  SourceSymbol, FileAnalysis, SourceAnalysisResult,
  EnhancedSourceSymbol, EnhancedFileAnalysis, BuildComponent,
  SymbolKind, SymbolVisibility, PragmaticLayer,
} from './types.js';
import { detectLanguage, resolveGrammarPath, isSupportedExtension } from './grammars.js';
import type { SupportedLanguage } from './grammars.js';
import { inferLayer } from './layer-inference.js';

const MAX_FILES = 500;
const MAX_FILE_SIZE = 100 * 1024; // 100KB

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', 'vendor',
  '__pycache__', '.next', '.nuxt', '.output', 'coverage',
  '.turbo', '.vercel', '.cache', 'tmp', '.tmp',
]);

// Lazy-loaded tree-sitter module and grammar cache
let ParserClass: typeof import('web-tree-sitter').Parser | null = null;
let LanguageClass: typeof import('web-tree-sitter').Language | null = null;
let parserInitialized = false;
const grammarCache = new Map<SupportedLanguage, import('web-tree-sitter').Language>();

/**
 * Initialize web-tree-sitter. Called once, lazily.
 */
async function initParser(): Promise<typeof import('web-tree-sitter').Parser> {
  if (ParserClass && parserInitialized) return ParserClass;

  const mod = await import('web-tree-sitter');
  await mod.Parser.init();
  ParserClass = mod.Parser;
  LanguageClass = mod.Language;
  parserInitialized = true;
  return mod.Parser;
}

/**
 * Load a grammar WASM file for the given language.
 * Caches loaded grammars to avoid repeated file reads.
 */
async function loadGrammar(language: SupportedLanguage): Promise<import('web-tree-sitter').Language> {
  const cached = grammarCache.get(language);
  if (cached) return cached;

  await initParser();
  const grammarPath = resolveGrammarPath(language);
  const lang = await LanguageClass!.load(grammarPath);
  grammarCache.set(language, lang);
  return lang;
}

/**
 * Collect source files eligible for analysis.
 * Walks the directory tree respecting ignore rules and limits.
 */
async function collectSourceFiles(
  rootPath: string,
  currentPath: string,
  files: string[],
  depth: number,
): Promise<void> {
  if (files.length >= MAX_FILES || depth > 6) return;

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await collectSourceFiles(rootPath, join(currentPath, entry.name), files, depth + 1);
    } else if (isSupportedExtension(entry.name)) {
      const fullPath = join(currentPath, entry.name);
      try {
        const s = await stat(fullPath);
        if (s.size <= MAX_FILE_SIZE) {
          files.push(fullPath);
        }
      } catch {
        // Skip files we can't stat
      }
    }
  }
}

/**
 * Extract exported symbols from a TypeScript/TSX file AST.
 */
function extractTypeScriptSymbols(
  tree: { rootNode: { children: unknown[] } },
  filePath: string,
): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode as { children: TreeNode[] };

  for (const node of root.children) {
    // Check for export keyword
    const isExported = node.type === 'export_statement';
    const declNode = isExported ? getDeclaration(node) : node;
    if (!declNode) continue;

    const symbol = extractSymbolFromNode(declNode, isExported, filePath);
    if (symbol) symbols.push(symbol);
  }

  return symbols;
}

/**
 * Extract exported symbols from a Go file AST.
 * In Go, capitalized names are exported.
 */
function extractGoSymbols(
  tree: { rootNode: { children: unknown[] } },
  filePath: string,
): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode as { children: TreeNode[] };

  for (const node of root.children) {
    if (node.type === 'function_declaration') {
      const nameNode = findChild(node, 'identifier');
      if (nameNode) {
        const name = nameNode.text;
        symbols.push({
          name,
          kind: 'function',
          exported: /^[A-Z]/.test(name),
          filePath,
        });
      }
    } else if (node.type === 'type_declaration') {
      const specNode = findChild(node, 'type_spec');
      if (specNode) {
        const nameNode = findChild(specNode, 'type_identifier');
        if (nameNode) {
          const name = nameNode.text;
          const typeBody = findChild(specNode, 'struct_type') ? 'class'
            : findChild(specNode, 'interface_type') ? 'interface'
            : 'type';
          symbols.push({
            name,
            kind: typeBody as SourceSymbol['kind'],
            exported: /^[A-Z]/.test(name),
            filePath,
          });
        }
      }
    }
  }

  return symbols;
}

/**
 * Extract public symbols from a Rust file AST.
 */
function extractRustSymbols(
  tree: { rootNode: { children: unknown[] } },
  filePath: string,
): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode as { children: TreeNode[] };

  for (const node of root.children) {
    const isPublic = hasVisibilityModifier(node);

    if (node.type === 'function_item') {
      const nameNode = findChild(node, 'identifier');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'function',
          exported: isPublic,
          filePath,
        });
      }
    } else if (node.type === 'struct_item') {
      const nameNode = findChild(node, 'type_identifier');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'class',
          exported: isPublic,
          filePath,
        });
      }
    } else if (node.type === 'trait_item') {
      const nameNode = findChild(node, 'type_identifier');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'interface',
          exported: isPublic,
          filePath,
        });
      }
    } else if (node.type === 'enum_item') {
      const nameNode = findChild(node, 'type_identifier');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'enum',
          exported: isPublic,
          filePath,
        });
      }
    } else if (node.type === 'impl_item') {
      const nameNode = findChild(node, 'type_identifier');
      if (nameNode && isPublic) {
        symbols.push({
          name: `impl ${nameNode.text}`,
          kind: 'class',
          exported: true,
          filePath,
        });
      }
    }
  }

  return symbols;
}

/**
 * Extract public symbols from a Java file AST.
 */
function extractJavaSymbols(
  tree: { rootNode: { children: unknown[] } },
  filePath: string,
): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode as { children: TreeNode[] };

  for (const node of root.children) {
    if (node.type === 'class_declaration' || node.type === 'interface_declaration') {
      const hasPublic = hasModifier(node, 'public');
      const nameNode = findChild(node, 'identifier');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: node.type === 'class_declaration' ? 'class' : 'interface',
          exported: hasPublic,
          filePath,
        });
      }
    }
  }

  return symbols;
}

/**
 * Extract public symbols from a C# file AST.
 */
function extractCSharpSymbols(
  tree: { rootNode: { children: unknown[] } },
  filePath: string,
): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];

  function walkCSharp(nodes: TreeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'class_declaration' || node.type === 'interface_declaration' || node.type === 'enum_declaration') {
        const hasPublic = hasModifier(node, 'public');
        const nameNode = findChild(node, 'identifier');
        if (nameNode) {
          const kind = node.type === 'class_declaration' ? 'class'
            : node.type === 'interface_declaration' ? 'interface'
            : 'enum';
          symbols.push({
            name: nameNode.text,
            kind: kind as SourceSymbol['kind'],
            exported: hasPublic,
            filePath,
          });
        }
      } else if (node.type === 'struct_declaration') {
        const hasPublic = hasModifier(node, 'public');
        const nameNode = findChild(node, 'identifier');
        if (nameNode) {
          symbols.push({
            name: nameNode.text,
            kind: 'class',
            exported: hasPublic,
            filePath,
          });
        }
      }
      // Recurse into namespace/class bodies
      if (node.namedChildren) {
        walkCSharp(node.namedChildren);
      }
    }
  }

  const root = tree.rootNode as { children: TreeNode[] };
  walkCSharp(root.children);
  return symbols;
}

/**
 * Extract function declarations from a Bash file AST.
 * Bash has no export/public concept, so all top-level functions are marked exported.
 */
function extractBashSymbols(
  tree: { rootNode: { children: unknown[] } },
  filePath: string,
): SourceSymbol[] {
  const symbols: SourceSymbol[] = [];
  const root = tree.rootNode as { children: TreeNode[] };

  for (const node of root.children) {
    if (node.type === 'function_definition') {
      const nameNode = findChild(node, 'word');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'function',
          exported: true,
          filePath,
        });
      }
    }
  }

  return symbols;
}

// --- AST helper types ---

interface TreeNode {
  type: string;
  text: string;
  children: TreeNode[];
  namedChildren: TreeNode[];
}

function findChild(node: TreeNode, type: string): TreeNode | null {
  for (const child of (node.namedChildren ?? node.children ?? [])) {
    if (child.type === type) return child;
  }
  return null;
}

function getDeclaration(exportNode: TreeNode): TreeNode | null {
  // export_statement wraps the actual declaration
  for (const child of (exportNode.namedChildren ?? exportNode.children ?? [])) {
    if (child.type !== 'export' && child.type !== 'default') {
      return child;
    }
  }
  return null;
}

function hasVisibilityModifier(node: TreeNode): boolean {
  for (const child of (node.namedChildren ?? node.children ?? [])) {
    if (child.type === 'visibility_modifier') return true;
  }
  return false;
}

function hasModifier(node: TreeNode, modifier: string): boolean {
  for (const child of (node.namedChildren ?? node.children ?? [])) {
    if (child.type === 'modifiers') {
      return child.text.includes(modifier);
    }
  }
  return false;
}

function extractSymbolFromNode(
  node: TreeNode,
  isExported: boolean,
  filePath: string,
): SourceSymbol | null {
  switch (node.type) {
    case 'function_declaration':
    case 'arrow_function': {
      const nameNode = findChild(node, 'identifier');
      if (nameNode) {
        return { name: nameNode.text, kind: 'function', exported: isExported, filePath };
      }
      return null;
    }
    case 'class_declaration': {
      const nameNode = findChild(node, 'type_identifier') ?? findChild(node, 'identifier');
      if (nameNode) {
        return { name: nameNode.text, kind: 'class', exported: isExported, filePath };
      }
      return null;
    }
    case 'interface_declaration': {
      const nameNode = findChild(node, 'type_identifier') ?? findChild(node, 'identifier');
      if (nameNode) {
        return { name: nameNode.text, kind: 'interface', exported: isExported, filePath };
      }
      return null;
    }
    case 'type_alias_declaration': {
      const nameNode = findChild(node, 'type_identifier') ?? findChild(node, 'identifier');
      if (nameNode) {
        return { name: nameNode.text, kind: 'type', exported: isExported, filePath };
      }
      return null;
    }
    case 'enum_declaration': {
      const nameNode = findChild(node, 'identifier');
      if (nameNode) {
        return { name: nameNode.text, kind: 'enum', exported: isExported, filePath };
      }
      return null;
    }
    case 'lexical_declaration':
    case 'variable_declaration': {
      // const Foo = ..., let bar = ...
      const declarator = findChild(node, 'variable_declarator');
      if (declarator) {
        const nameNode = findChild(declarator, 'identifier');
        if (nameNode) {
          return { name: nameNode.text, kind: 'const', exported: isExported, filePath };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Analyze a single source file with tree-sitter.
 * Returns the extracted symbols.
 */
async function analyzeFile(
  filePath: string,
  language: SupportedLanguage,
): Promise<FileAnalysis> {
  const Parser = await initParser();
  const grammar = await loadGrammar(language);

  const parser = new Parser();
  parser.setLanguage(grammar);

  const content = await readFile(filePath, 'utf-8');
  const tree = parser.parse(content);

  if (!tree) {
    parser.delete();
    return { path: filePath, language, symbols: [] };
  }

  let symbols: SourceSymbol[];
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      symbols = extractTypeScriptSymbols(tree, filePath);
      break;
    case 'go':
      symbols = extractGoSymbols(tree, filePath);
      break;
    case 'rust':
      symbols = extractRustSymbols(tree, filePath);
      break;
    case 'java':
      symbols = extractJavaSymbols(tree, filePath);
      break;
    case 'csharp':
      symbols = extractCSharpSymbols(tree, filePath);
      break;
    case 'bash':
      symbols = extractBashSymbols(tree, filePath);
      break;
    default:
      symbols = [];
  }

  parser.delete();

  return {
    path: filePath,
    language,
    symbols,
  };
}

/**
 * Format source analysis results into a summary string for AI prompt inclusion.
 * Groups exported symbols by directory for readability.
 */
function formatSummary(files: FileAnalysis[], rootPath: string): string {
  if (files.length === 0) return '';

  // Group by directory
  const byDir = new Map<string, SourceSymbol[]>();
  for (const file of files) {
    const relPath = relative(rootPath, file.path);
    const dir = dirname(relPath);
    const existing = byDir.get(dir) ?? [];
    existing.push(...file.symbols.filter(s => s.exported));
    byDir.set(dir, existing);
  }

  const lines: string[] = [];
  lines.push(`Source analysis: ${files.length} files parsed`);
  lines.push('');

  for (const [dir, symbols] of [...byDir.entries()].sort()) {
    if (symbols.length === 0) continue;
    lines.push(`${dir}/`);
    for (const sym of symbols) {
      const sig = sym.signature ? ` ${sym.signature}` : '';
      lines.push(`  ${sym.kind} ${sym.name}${sig}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Analyze source files in a codebase using tree-sitter.
 * Extracts exported function/class/interface/type declarations.
 *
 * @param rootPath - Git repository root
 * @returns Source analysis with per-file symbols and public API
 */
export async function analyzeSource(rootPath: string): Promise<SourceAnalysisResult> {
  // Collect eligible files
  const filePaths: string[] = [];
  await collectSourceFiles(rootPath, rootPath, filePaths, 0);

  if (filePaths.length === 0) {
    return { files: [], publicApi: [], summary: '' };
  }

  // Analyze each file
  const files: FileAnalysis[] = [];
  const warnings: string[] = [];

  for (const filePath of filePaths) {
    const language = detectLanguage(filePath);
    if (!language) continue;

    try {
      const analysis = await analyzeFile(filePath, language);
      files.push(analysis);
    } catch (err) {
      warnings.push(`Failed to parse ${relative(rootPath, filePath)}: ${(err as Error).message}`);
    }
  }

  // Aggregate public API (all exported symbols)
  const publicApi = files.flatMap(f => f.symbols.filter(s => s.exported));

  // Format summary
  const summary = formatSummary(files, rootPath);

  if (filePaths.length >= MAX_FILES) {
    const truncWarning = `Warning: Only ${MAX_FILES} of ${filePaths.length}+ source files were analyzed.`;
    return {
      files,
      publicApi,
      summary: `${truncWarning}\n\n${summary}`,
    };
  }

  return { files, publicApi, summary };
}

// =========================================================================
// Enhanced Source Analysis
// =========================================================================

/**
 * TreeNode with position info from web-tree-sitter.
 * These properties exist on real tree-sitter nodes but aren't declared
 * in the lightweight TreeNode interface above.
 */
interface PositionedTreeNode extends TreeNode {
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  previousNamedSibling: PositionedTreeNode | null;
}

/**
 * Extract a display-friendly signature from a declaration node.
 * Truncates at the first opening brace to show just the header.
 */
function extractSignatureDisplay(node: PositionedTreeNode): string | undefined {
  const text = node.text;
  if (!text || text.length < 3) return undefined;

  // For const/let/var declarations, take just the first line
  if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
    const line = text.split('\n')[0].trim();
    return line.length > 200 ? line.slice(0, 200) + '...' : line;
  }

  // Truncate at first opening brace (function/class body)
  const braceIdx = text.indexOf('{');
  if (braceIdx > 0) {
    const sig = text.slice(0, braceIdx).trim();
    return sig.length > 200 ? sig.slice(0, 200) + '...' : sig;
  }

  const line = text.split('\n')[0].trim();
  return line.length > 200 ? line.slice(0, 200) + '...' : line;
}

/**
 * Extract a doc summary from the previous named sibling if it's a comment.
 */
function extractDocSummary(node: PositionedTreeNode): string | undefined {
  const prev = node.previousNamedSibling;
  if (!prev) return undefined;

  if (prev.type !== 'comment' && prev.type !== 'block_comment' && prev.type !== 'line_comment') {
    return undefined;
  }

  const cleaned = prev.text
    .replace(/^\/\*\*?\s*|\s*\*\/$/gs, '')
    .replace(/^\s*\*\s?/gm, '')
    .replace(/^\/\/\s?/gm, '')
    .replace(/^#\s?/gm, '')
    .trim();

  return cleaned.split('\n')[0]?.trim() || undefined;
}

/**
 * Determine visibility from language conventions and AST modifiers.
 */
function inferVisibilityFromLanguage(
  language: SupportedLanguage,
  isExported: boolean,
  node: TreeNode,
): SymbolVisibility {
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      return isExported ? 'exported' : 'file';
    case 'go':
      return isExported ? 'public' : 'file';
    case 'rust':
      return isExported ? 'public' : 'file';
    case 'java':
      if (hasModifier(node, 'private')) return 'private';
      if (hasModifier(node, 'protected')) return 'protected';
      return isExported ? 'public' : 'file';
    case 'csharp':
      if (hasModifier(node, 'private')) return 'private';
      if (hasModifier(node, 'protected')) return 'protected';
      if (hasModifier(node, 'internal')) return 'internal';
      return isExported ? 'public' : 'file';
    case 'bash':
      return 'exported';
    default:
      return 'unknown';
  }
}

/**
 * Enrich a symbol's kind based on its layer and language context.
 */
function enrichKind(
  baseKind: SourceSymbol['kind'],
  layer: PragmaticLayer,
  language: SupportedLanguage,
): SymbolKind {
  if (language === 'bash' && baseKind === 'function') return 'script_fn';
  if (layer === 'api' && (baseKind === 'function' || baseKind === 'method')) return 'route';
  if (layer === 'cli' && baseKind === 'function') return 'command';
  return baseKind;
}

/**
 * Build semantic tags for a symbol.
 */
function buildEnhancedTags(
  kind: SymbolKind,
  layer: PragmaticLayer,
  isEntrypoint: boolean,
  componentTags: string[],
): string[] {
  const tags = [`layer:${layer}`, `kind:${kind}`];
  if (layer === 'api') tags.push('cap:http');
  if (layer === 'tests') tags.push('test:true');
  if (isEntrypoint) tags.push('entrypoint:true');
  for (const t of componentTags) {
    if (t.startsWith('framework:')) tags.push(t);
  }
  return tags;
}

/**
 * Find which BuildComponent owns a file based on longest rootPath prefix match.
 */
function findOwnerComponent(
  absPath: string,
  components: BuildComponent[],
): BuildComponent | undefined {
  let best: BuildComponent | undefined;
  let bestLen = 0;
  for (const comp of components) {
    if (absPath.startsWith(comp.rootPath) && comp.rootPath.length > bestLen) {
      best = comp;
      bestLen = comp.rootPath.length;
    }
  }
  return best;
}

/**
 * Extract a declaration name from an AST node (generic across languages).
 */
function extractDeclName(node: TreeNode): string | null {
  switch (node.type) {
    case 'function_declaration':
    case 'function_item':
    case 'function_definition':
      return (findChild(node, 'identifier') ?? findChild(node, 'word'))?.text ?? null;

    case 'class_declaration':
    case 'struct_item':
    case 'trait_item':
    case 'enum_item':
    case 'interface_declaration':
    case 'type_alias_declaration':
    case 'enum_declaration':
    case 'struct_declaration':
      return (findChild(node, 'type_identifier') ?? findChild(node, 'identifier'))?.text ?? null;

    case 'lexical_declaration':
    case 'variable_declaration': {
      const d = findChild(node, 'variable_declarator');
      return d ? findChild(d, 'identifier')?.text ?? null : null;
    }

    case 'type_declaration': {
      const spec = findChild(node, 'type_spec');
      return spec ? (findChild(spec, 'type_identifier')?.text ?? null) : null;
    }

    case 'impl_item': {
      const ti = findChild(node, 'type_identifier');
      return ti ? `impl ${ti.text}` : null;
    }

    default:
      return null;
  }
}

/**
 * Build a Map from symbol name → positioned AST node for top-level declarations.
 * For export statements, maps to the export_statement (so source.range covers the full export).
 */
function matchSymbolsToNodes(
  rootNode: unknown,
  language: SupportedLanguage,
): Map<string, PositionedTreeNode> {
  const map = new Map<string, PositionedTreeNode>();
  const root = rootNode as { children: PositionedTreeNode[] };
  if (!root.children) return map;

  function walk(nodes: PositionedTreeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'export_statement') {
        const decl = getDeclaration(node) as PositionedTreeNode | null;
        if (decl) {
          const name = extractDeclName(decl);
          if (name && !map.has(name)) map.set(name, node);
        }
      } else {
        const name = extractDeclName(node);
        if (name && !map.has(name)) map.set(name, node);
      }
      // C# needs recursion into namespaces/class bodies
      if (language === 'csharp' && node.namedChildren) {
        walk(node.namedChildren as PositionedTreeNode[]);
      }
    }
  }

  walk(root.children);
  return map;
}

/**
 * Analyze a single source file producing both legacy and enhanced results.
 */
async function analyzeFileEnhanced(
  filePath: string,
  language: SupportedLanguage,
  rootPath: string,
  components: BuildComponent[],
): Promise<{ legacy: FileAnalysis; enhanced: EnhancedFileAnalysis } | null> {
  const Parser = await initParser();
  const grammar = await loadGrammar(language);
  const parser = new Parser();
  parser.setLanguage(grammar);

  const content = await readFile(filePath, 'utf-8');
  const tree = parser.parse(content);

  if (!tree) {
    parser.delete();
    return null;
  }

  const relPath = relative(rootPath, filePath);

  // --- Legacy symbols (existing extractors) ---
  let legacySymbols: SourceSymbol[];
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      legacySymbols = extractTypeScriptSymbols(tree, filePath);
      break;
    case 'go':
      legacySymbols = extractGoSymbols(tree, filePath);
      break;
    case 'rust':
      legacySymbols = extractRustSymbols(tree, filePath);
      break;
    case 'java':
      legacySymbols = extractJavaSymbols(tree, filePath);
      break;
    case 'csharp':
      legacySymbols = extractCSharpSymbols(tree, filePath);
      break;
    case 'bash':
      legacySymbols = extractBashSymbols(tree, filePath);
      break;
    default:
      legacySymbols = [];
  }

  // --- Enhanced metadata ---
  const layer = inferLayer(relPath, tree.rootNode, language);
  const component = findOwnerComponent(filePath, components);
  const isEntrypoint = component
    ? component.entrypoints.some(ep => relPath === ep || relPath.endsWith(ep))
    : false;
  const componentTags = component?.tags ?? [];

  // Match legacy symbols to AST nodes for position/doc/sig extraction
  const nodeMap = matchSymbolsToNodes(tree.rootNode, language);

  const enhancedSymbols: EnhancedSourceSymbol[] = legacySymbols.map(sym => {
    const astNode = nodeMap.get(sym.name);
    const kind = enrichKind(sym.kind, layer, language);
    const visibility = inferVisibilityFromLanguage(language, sym.exported, astNode ?? ({} as TreeNode));
    const tags = buildEnhancedTags(kind, layer, isEntrypoint, componentTags);

    // Extract signature from the declaration node (inside export_statement if applicable)
    const sigNode = astNode?.type === 'export_statement'
      ? (getDeclaration(astNode) as PositionedTreeNode ?? astNode)
      : astNode;
    const sig = sigNode ? extractSignatureDisplay(sigNode) : undefined;
    // Extract doc from the outer node (comment is before the export_statement)
    const doc = astNode ? extractDocSummary(astNode) : undefined;

    return {
      name: sym.name,
      kind,
      visibility,
      filePath: relPath,
      ...(sig ? { signature: { display: sig } } : {}),
      ...(doc ? { doc: { summary: doc } } : {}),
      source: {
        file: filePath,
        range: {
          startLine: (astNode?.startPosition?.row ?? 0) + 1,
          endLine: (astNode?.endPosition?.row ?? 0) + 1,
        },
      },
      tags,
    };
  });

  parser.delete();

  return {
    legacy: { path: filePath, language, symbols: legacySymbols },
    enhanced: {
      path: relPath,
      language,
      symbols: enhancedSymbols,
      layer,
      componentId: component?.id,
    },
  };
}

/**
 * Analyze source files with enhanced metadata: layer inference, component
 * assignment, visibility, signatures, doc summaries, source ranges, and tags.
 *
 * Returns both legacy results (for backward compatibility) and enhanced
 * per-file analysis with richer symbol information.
 */
export async function analyzeSourceEnhanced(
  rootPath: string,
  components?: BuildComponent[],
): Promise<{ legacy: SourceAnalysisResult; enhanced: EnhancedFileAnalysis[] }> {
  const filePaths: string[] = [];
  await collectSourceFiles(rootPath, rootPath, filePaths, 0);

  if (filePaths.length === 0) {
    return {
      legacy: { files: [], publicApi: [], summary: '' },
      enhanced: [],
    };
  }

  const legacyFiles: FileAnalysis[] = [];
  const enhancedFiles: EnhancedFileAnalysis[] = [];
  const comps = components ?? [];

  for (const filePath of filePaths) {
    const language = detectLanguage(filePath);
    if (!language) continue;

    try {
      const result = await analyzeFileEnhanced(filePath, language, rootPath, comps);
      if (result) {
        legacyFiles.push(result.legacy);
        enhancedFiles.push(result.enhanced);
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  const publicApi = legacyFiles.flatMap(f => f.symbols.filter(s => s.exported));
  const summary = formatSummary(legacyFiles, rootPath);

  return {
    legacy: {
      files: legacyFiles,
      publicApi,
      summary: filePaths.length >= MAX_FILES
        ? `Warning: Only ${MAX_FILES} of ${filePaths.length}+ source files were analyzed.\n\n${summary}`
        : summary,
    },
    enhanced: enhancedFiles,
  };
}
