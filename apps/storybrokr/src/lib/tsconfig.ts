import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StorybrokrError } from './errors.js';

// Parse JSONC: strip // and /* */ comments and trailing commas so JSON parses.
export function parseJsonc(text: string): unknown {
  // Remove block comments, but preserve strings
  let result = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];
    // Handle string boundaries
    if (char === '"' && (i === 0 || text[i - 1] !== '\\')) {
      inString = !inString;
      result += char;
      i += 1;
    } else if (!inString && char === '/' && next === '*') {
      // Skip block comment
      i += 2;
      while (i < text.length - 1) {
        if (text[i] === '*' && text[i + 1] === '/') {
          i += 2;
          break;
        }
        i += 1;
      }
    } else {
      result += char;
      i += 1;
    }
  }
  const noBlock = result;
  const noLine = noBlock.replace(/(^|[^:"'])\/\/.*$/gm, '$1');
  const noTrailing = noLine.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(noTrailing);
}

/** compilerOptions.paths from <hostRoot>/tsconfig.json, or {} when absent. */
export function readTsconfigPaths(hostRoot: string): Record<string, string[]> {
  const file = join(hostRoot, 'tsconfig.json');
  if (!existsSync(file)) return {};
  try {
    const parsed = parseJsonc(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as { compilerOptions?: { paths?: Record<string, string[]> } };
    return obj.compilerOptions?.paths ?? {};
  } catch (err) {
    throw new StorybrokrError(
      'HOST_INVALID',
      `${file} is not valid JSONC (${(err as Error).message})`,
    );
  }
}
