import { createRequire } from 'node:module';
import { extname } from 'node:path';

/**
 * Supported languages for tree-sitter source analysis.
 */
export type SupportedLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'go'
  | 'rust'
  | 'java'
  | 'csharp'
  | 'bash';

const EXTENSION_MAP: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'csharp',
  '.sh': 'bash',
  '.bash': 'bash',
};

const GRAMMAR_FILE_MAP: Record<SupportedLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  java: 'tree-sitter-java.wasm',
  csharp: 'tree-sitter-c_sharp.wasm',
  bash: 'tree-sitter-bash.wasm',
};

/**
 * Detect language from file extension. Returns null for unsupported files.
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_MAP[ext] ?? null;
}

/**
 * Check if a file extension is supported for source analysis.
 */
export function isSupportedExtension(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}

/**
 * Resolve the WASM grammar file path for a language.
 * Uses createRequire to resolve from node_modules.
 */
export function resolveGrammarPath(language: SupportedLanguage): string {
  const require = createRequire(import.meta.url);
  const grammarFile = GRAMMAR_FILE_MAP[language];
  return require.resolve(`tree-sitter-wasms/out/${grammarFile}`);
}

/**
 * Get all supported file extensions.
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXTENSION_MAP);
}
