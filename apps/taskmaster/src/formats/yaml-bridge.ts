import yaml from 'js-yaml';

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
 * Uses js-yaml's DEFAULT_SCHEMA (safe) and wraps errors with line info.
 */
export function safeLoad(content: string): unknown {
  try {
    return yaml.load(content, { schema: yaml.DEFAULT_SCHEMA });
  } catch (err: unknown) {
    if (err instanceof yaml.YAMLException) {
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
    quotingType: "'",
    forceQuotes: false,
  });
}
