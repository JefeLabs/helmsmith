import { extname } from 'node:path';
import { parseMarkdown } from './markdown.js';
import { generateTasks } from './task-generator.js';
import { parseText } from './text.js';
import type {
  DependencyInferrer,
  ParsedSection,
  ParseOptions,
  ParseResult,
  PlanFormat,
} from './types.js';
import { noopInferrer } from './types.js';
import { parseYamlPlan } from './yaml-plan.js';

export { parseWithAI, parseWithArchitecturePipeline } from './ai-parser.js';
export { getNextId, renumberTasks } from './task-generator.js';
export type { DependencyInferrer, ParseOptions, ParseResult, PlanFormat } from './types.js';
export { noopInferrer } from './types.js';

/**
 * Detect the plan format from a filename, with content fallback.
 *
 * Priority:
 * 1. File extension (.md -> markdown, .yaml/.yml -> yaml, .txt -> text)
 * 2. Content inspection: YAML frontmatter (---) -> yaml, markdown headings (# ) -> markdown
 * 3. Default: text
 */
export function detectFormat(filename: string, content: string): PlanFormat {
  const ext = extname(filename).toLowerCase();

  switch (ext) {
    case '.md':
    case '.markdown':
      return 'markdown';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.txt':
      return 'text';
  }

  // Content fallback for ambiguous or missing extensions
  const firstLines = content.split('\n', 10).join('\n');

  // Check for YAML structure: starts with "tasks:" or has YAML-like key: value lines
  if (/^tasks:\s*$/m.test(firstLines)) {
    return 'yaml';
  }

  // Check for markdown headings
  if (/^#{1,6}\s+.+/m.test(firstLines)) {
    return 'markdown';
  }

  return 'text';
}

/**
 * Count sections recursively in a ParsedSection tree.
 */
function countSections(sections: { children: { children: unknown[] }[] }[]): number {
  let count = sections.length;
  for (const section of sections) {
    count += countSections(section.children as typeof sections);
  }
  return count;
}

/**
 * Parse a plan file into structured tasks.
 *
 * This is the main entry point for the parser module. It auto-detects
 * the format, delegates to the appropriate format parser, then pipes
 * through the task generator for ID assignment and type mapping.
 *
 * @param content - Raw file content
 * @param filename - Original filename (used for format detection)
 * @param options - Parser configuration (style, defaultStatus, numTasks)
 * @param inferrer - Optional dependency inferrer (defaults to no-op)
 * @returns ParseResult with tasks, warnings, and metadata
 */
export async function parsePlan(
  content: string,
  filename: string,
  options: ParseOptions,
  inferrer: DependencyInferrer = noopInferrer,
): Promise<ParseResult> {
  const format = detectFormat(filename, content);
  const warnings: string[] = [];

  // Route to the correct format parser
  // biome-ignore lint/suspicious/noImplicitAnyLet: assigned in try/catch below
  let sections;
  switch (format) {
    case 'markdown':
      sections = parseMarkdown(content);
      break;
    case 'yaml':
      sections = parseYamlPlan(content);
      break;
    case 'text':
      sections = parseText(content);
      break;
  }

  // Unwrap document-title wrapper: when the parser returns a single root section
  // whose children are the real content sections, promote those children to
  // top-level. This handles documents like "# Implementation Plan" with all
  // actionable sections at ## depth — without this, `list` shows one useless wrapper.
  if (sections.length === 1 && sections[0].children.length > 0) {
    const wrapper = sections[0];
    sections = wrapper.children;
    // Shift depths so children start at 1 (top-level)
    const shift = sections[0].depth - 1;
    if (shift > 0) {
      function shiftDepth(secs: ParsedSection[]): void {
        for (const s of secs) {
          s.depth -= shift;
          shiftDepth(s.children);
        }
      }
      shiftDepth(sections);
    }
  }

  const sectionsFound = countSections(sections);

  // Handle no-content edge case: text parser returns a single "Untitled" section
  if (
    sections.length === 1 &&
    sections[0].title === 'Untitled' &&
    sections[0].body === content.trim()
  ) {
    warnings.push('No headings found; created a single task from the file content.');
  }

  // Generate TaskNode[] from sections
  const { tasks, warnings: genWarnings } = generateTasks(sections, options);
  warnings.push(...genWarnings);

  // Run dependency inferrer (no-op by default)
  const finalTasks = await inferrer.inferDependencies(tasks);

  return {
    tasks: finalTasks,
    warnings,
    metadata: {
      format,
      sectionsFound,
      tasksGenerated: finalTasks.length,
    },
  };
}
