import * as yaml from 'js-yaml';

/**
 * Error thrown when YAML parsing fails. Includes line/column info when available.
 */
export class YamlParseError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = 'YamlParseError';
    this.line = line;
    this.column = column;
  }
}

/**
 * Safely load a YAML string into a JS value.
 * Uses js-yaml's CORE_SCHEMA (YAML 1.2 core, the v5 default; safe) and wraps errors with line info.
 */
export function safeLoad(content: string): unknown {
  // js-yaml 5 throws "expected a document, but the input is empty" where v4
  // returned undefined. Keep the v4 contract: empty or whitespace-only input
  // (and comment-only input, caught below) loads as undefined.
  if (content.trim() === '') return undefined;
  try {
    return yaml.load(content, { schema: yaml.CORE_SCHEMA });
  } catch (err: unknown) {
    if (err instanceof yaml.YAMLException) {
      if (err.reason?.includes('input is empty')) return undefined;
      const mark = err.mark;
      throw new YamlParseError(
        mark
          ? `YAML parse error at line ${mark.line + 1}, column ${mark.column + 1}: ${err.reason}`
          : `YAML parse error: ${err.message}`,
        mark ? mark.line + 1 : undefined,
        mark ? mark.column + 1 : undefined,
      );
    }
    throw err;
  }
}

/**
 * Safely dump a JS value to a YAML string.
 * Uses clean output options for human-readable output.
 */
export function safeDump(data: unknown): string {
  return yaml.dump(data, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    quoteStyle: 'single',
    forceQuotes: false,
  });
}
