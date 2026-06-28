import type { ParsedSection } from './types.js';

/**
 * Detect heading patterns in plain text lines.
 * Returns an array of { lineIndex, title, depth } for detected headings.
 */
interface DetectedHeading {
  lineIndex: number;
  title: string;
  depth: number;
  /** Number of lines consumed by this heading (1 for single-line, 2 for underline) */
  consumedLines: number;
}

/**
 * Scan lines for heading patterns:
 * - Underline with === (depth 1) or --- (depth 2) on the line after a title
 * - ALL CAPS lines of 3+ chars (depth 1)
 * - Numbered patterns like "1." or "1.2" or "1.2.3" (depth = dot count + 1)
 */
function detectHeadings(lines: string[]): DetectedHeading[] {
  const headings: DetectedHeading[] = [];
  const usedLines = new Set<number>();

  // Pass 1: Underline-style headings (===, ---)
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i].trim();
    const next = lines[i + 1].trim();

    if (current.length === 0) continue;

    if (next.length >= 3 && /^=+$/.test(next)) {
      headings.push({ lineIndex: i, title: current, depth: 1, consumedLines: 2 });
      usedLines.add(i);
      usedLines.add(i + 1);
    } else if (next.length >= 3 && /^-+$/.test(next)) {
      headings.push({ lineIndex: i, title: current, depth: 2, consumedLines: 2 });
      usedLines.add(i);
      usedLines.add(i + 1);
    }
  }

  // Pass 2: ALL CAPS and numbered headings (skip lines already used by underlines)
  for (let i = 0; i < lines.length; i++) {
    if (usedLines.has(i)) continue;

    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;

    // ALL CAPS: 3+ chars, no lowercase letters, at least one uppercase letter
    if (trimmed.length >= 3 && /^[^a-z]*$/.test(trimmed) && /[A-Z]/.test(trimmed)) {
      // Avoid matching lines that are just symbols or numbers
      if (/[A-Z]{2,}/.test(trimmed)) {
        headings.push({ lineIndex: i, title: trimmed, depth: 1, consumedLines: 1 });
        usedLines.add(i);
        continue;
      }
    }

    // Numbered pattern: "1." "1:" "1.2." "1.2.3" followed by title text
    const numberedMatch = trimmed.match(/^(\d+(?:\.\d+)*)[.:)\s]\s*(.+)$/);
    if (numberedMatch) {
      const numberPart = numberedMatch[1];
      const titlePart = numberedMatch[2].trim();
      const dotCount = (numberPart.match(/\./g) ?? []).length;
      const depth = dotCount + 1;

      if (titlePart.length > 0) {
        headings.push({ lineIndex: i, title: titlePart, depth, consumedLines: 1 });
        usedLines.add(i);
      }
    }
  }

  // Sort by line index
  headings.sort((a, b) => a.lineIndex - b.lineIndex);

  return headings;
}

/**
 * Build a nested ParsedSection tree from flat sections.
 */
function buildTree(flatSections: ParsedSection[]): ParsedSection[] {
  const roots: ParsedSection[] = [];
  const stack: ParsedSection[] = [];

  for (const section of flatSections) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= section.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }

    stack.push(section);
  }

  return roots;
}

/**
 * Parse plain text content into a nested tree of ParsedSection objects.
 *
 * Detects headings by common text patterns:
 * - Lines followed by === (depth 1) or --- (depth 2)
 * - ALL CAPS lines (depth 1)
 * - Lines starting with a number followed by period/colon (depth based on dots)
 *
 * Falls back to a single section if no heading patterns found.
 */
export function parseText(content: string): ParsedSection[] {
  const lines = content.split('\n');
  const headings = detectHeadings(lines);

  if (headings.length === 0) {
    // No headings detected — return single section with full content
    return [
      {
        title: 'Untitled',
        depth: 1,
        body: content.trim(),
        children: [],
      },
    ];
  }

  // Build flat sections from headings
  const flatSections: ParsedSection[] = [];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const startLine = heading.lineIndex + heading.consumedLines;
    const endLine = i < headings.length - 1 ? headings[i + 1].lineIndex : lines.length;

    const bodyLines = lines.slice(startLine, endLine);
    const body = bodyLines.join('\n').trim();

    flatSections.push({
      title: heading.title,
      depth: heading.depth,
      body,
      children: [],
    });
  }

  return buildTree(flatSections);
}
