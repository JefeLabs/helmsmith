import type { PragmaticLayer } from './types.js';

// --- Tree-sitter node interface (duck-typed, no library import) ---

interface TreeNode {
  type: string;
  text: string;
  children: TreeNode[];
  namedChildren: TreeNode[];
}

// --- Path-based layer inference ---

/**
 * Path rules checked top-down (first match wins).
 * Each rule maps a set of segment names or file-level patterns to a layer.
 */
interface PathRule {
  layer: PragmaticLayer;
  /** Directory segment names (matched against individual path segments). */
  segments?: string[];
  /** File extension patterns (matched against the basename). */
  extensions?: string[];
  /** Exact basename matches. */
  basenames?: string[];
  /** Basename prefix matches. */
  basenamePrefixes?: string[];
  /** Basename suffix patterns (e.g. `.test.` anywhere in the basename). */
  basenameSuffixes?: string[];
}

const PATH_RULES: PathRule[] = [
  // tests
  {
    layer: 'tests',
    segments: ['__tests__'],
    basenameSuffixes: ['.test.', '.spec.'],
    basenamePrefixes: ['test'],
  },
  // scripts
  {
    layer: 'scripts',
    segments: ['scripts'],
    extensions: ['.sh', '.bash'],
    basenames: ['Makefile', 'justfile'],
    basenamePrefixes: ['Taskfile'],
  },
  // cli
  {
    layer: 'cli',
    segments: ['cmd', 'cli', 'bin'],
  },
  // api
  {
    layer: 'api',
    segments: ['routes', 'controllers', 'handlers', 'api', 'endpoints'],
  },
  // service
  {
    layer: 'service',
    segments: ['services', 'usecases', 'workflows'],
  },
  // domain
  {
    layer: 'domain',
    segments: ['domain', 'models', 'entities', 'core'],
  },
  // data
  {
    layer: 'data',
    segments: ['repo', 'repositories', 'dao', 'migrations', 'db', 'data', 'queries'],
  },
  // infra
  {
    layer: 'infra',
    segments: ['config', 'infra', 'adapters', 'clients', 'auth', 'logging', 'utils', 'lib'],
  },
];

/**
 * Check whether a path segment matches a "tests" directory pattern.
 * Handles `tests`, `test`, `__tests__`, and any segment starting with `test`
 * (e.g. `test-helpers`, `tests-integration`).
 */
function isTestSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  return lower === '__tests__' || lower.startsWith('test');
}

/**
 * Infer a pragmatic layer from a file's relative path using simple string matching.
 *
 * Rules are evaluated top-down; the first match wins.
 * If no rule matches, the default layer `'infra'` is returned.
 */
export function inferLayerFromPath(relativePath: string): PragmaticLayer {
  // Normalise separators to forward slash
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const basename = segments[segments.length - 1] ?? '';

  for (const rule of PATH_RULES) {
    // Check directory segments
    if (rule.segments) {
      // Special handling for tests: use the fuzzy isTestSegment matcher
      if (rule.layer === 'tests') {
        if (segments.some((s) => isTestSegment(s))) return 'tests';
      } else {
        if (segments.some((s) => rule.segments!.includes(s))) return rule.layer;
      }
    }

    // Check basename suffixes (e.g. `.test.`, `.spec.`)
    if (rule.basenameSuffixes) {
      if (rule.basenameSuffixes.some((suffix) => basename.includes(suffix))) return rule.layer;
    }

    // Check exact basenames
    if (rule.basenames) {
      if (rule.basenames.includes(basename)) return rule.layer;
    }

    // Check basename prefixes (e.g. `Taskfile`)
    if (rule.basenamePrefixes && rule.layer !== 'tests') {
      if (rule.basenamePrefixes.some((prefix) => basename.startsWith(prefix))) return rule.layer;
    }

    // Check file extensions
    if (rule.extensions) {
      if (rule.extensions.some((ext) => basename.endsWith(ext))) return rule.layer;
    }
  }

  // Default
  return 'infra';
}

// --- AST-based layer inference ---

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'use', 'route']);
const TEST_FUNCTIONS = new Set(['describe', 'it', 'test']);
const CLI_PATTERNS = ['new Command(', 'program.command(', '.addCommand(', 'program.parse('];

/**
 * Walk tree-sitter child nodes shallowly (one level) looking for AST signals
 * that override the path-based layer.
 *
 * The walk is intentionally shallow (direct children + their named children)
 * to keep it fast on large ASTs while still catching top-level patterns.
 */
function walkForSignals(nodes: TreeNode[]): PragmaticLayer | null {
  for (const node of nodes) {
    const detected = detectNodeLayer(node);
    if (detected) return detected;

    // Recurse into named children (one level deeper)
    if (node.namedChildren && node.namedChildren.length > 0) {
      for (const child of node.namedChildren) {
        const childDetected = detectNodeLayer(child);
        if (childDetected) return childDetected;
      }
    }
  }
  return null;
}

/**
 * Check a single tree-sitter node for layer-indicating patterns.
 */
function detectNodeLayer(node: TreeNode): PragmaticLayer | null {
  const text = node.text;

  // --- Route / API patterns ---
  if (node.type === 'call_expression' || node.type === 'expression_statement') {
    // app.get('/path' or router.post('/path' style
    if (/^(?:app|router)\.\w+\(/.test(text)) {
      // Extract the method name after the dot
      const match = text.match(/^(?:app|router)\.(\w+)\(/);
      if (match && HTTP_METHODS.has(match[1].toLowerCase())) {
        return 'api';
      }
    }
  }

  if (node.type === 'member_expression') {
    // Property is an HTTP method
    const propMatch = text.match(/\.(\w+)$/);
    if (propMatch && HTTP_METHODS.has(propMatch[1].toLowerCase())) {
      return 'api';
    }
  }

  // --- Test patterns ---
  if (node.type === 'call_expression' || node.type === 'expression_statement') {
    for (const fn of TEST_FUNCTIONS) {
      if (text.startsWith(`${fn}(`)) {
        return 'tests';
      }
    }
  }

  // Go test function: func TestXxx(t *testing.T)
  if (node.type === 'function_declaration') {
    const match = text.match(/^func\s+(Test\w+)/);
    if (match) return 'tests';
  }

  // Rust #[test] attribute
  if (node.type === 'attribute_item' || node.type === 'attribute') {
    if (text.includes('test')) return 'tests';
  }

  // --- CLI patterns ---
  if (
    node.type === 'call_expression' ||
    node.type === 'expression_statement' ||
    node.type === 'new_expression'
  ) {
    for (const pat of CLI_PATTERNS) {
      if (text.includes(pat)) return 'cli';
      // Handle `new Command` without parens at the exact start
      if (pat === 'new Command(' && text.startsWith('new Command')) return 'cli';
    }
  }

  // argparse import
  if (node.type === 'import_statement' || node.type === 'import_declaration') {
    if (text.includes('argparse')) return 'cli';
  }

  return null;
}

/**
 * Infer a pragmatic layer from a tree-sitter AST root node.
 *
 * Walks the top-level children of the AST looking for patterns that indicate
 * a specific layer (route definitions, test functions, CLI command construction).
 *
 * @param rootNode  - A tree-sitter root node (duck-typed, no library dependency).
 * @param language  - The source language (e.g. `'typescript'`, `'go'`, `'rust'`).
 * @param filePath  - The file path (unused currently, reserved for future heuristics).
 * @returns The inferred layer, or `null` if no AST signal was detected.
 */
export function inferLayerFromAST(
  rootNode: unknown,
  _language: string,
  _filePath: string,
): PragmaticLayer | null {
  if (!rootNode || typeof rootNode !== 'object') return null;

  const node = rootNode as TreeNode;
  const children = node.children ?? node.namedChildren ?? [];
  if (!Array.isArray(children) || children.length === 0) return null;

  return walkForSignals(children);
}

// --- Combined inference ---

/**
 * Infer a pragmatic layer for a source file.
 *
 * If a tree-sitter root node is provided, AST-based inference is attempted first.
 * If the AST yields no signal (returns `null`), or no root node was given,
 * falls back to path-based inference.
 *
 * @param relativePath - The file's path relative to the repository root.
 * @param rootNode     - Optional tree-sitter AST root node.
 * @param language     - Optional source language string (required when rootNode is provided).
 * @returns The inferred pragmatic layer.
 */
export function inferLayer(
  relativePath: string,
  rootNode?: unknown,
  language?: string,
): PragmaticLayer {
  if (rootNode) {
    const astLayer = inferLayerFromAST(rootNode, language ?? '', relativePath);
    if (astLayer) return astLayer;
  }
  return inferLayerFromPath(relativePath);
}
