import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import type { ParsedSection } from './types.js';

/**
 * Serialize a marked token back into a readable text representation
 * suitable for a task description.
 */
function tokenToText(token: Token): string {
  switch (token.type) {
    case 'paragraph':
      return (token as Tokens.Paragraph).text + '\n\n';
    case 'list': {
      const list = token as Tokens.List;
      return (
        list.items
          .map((item, i) => {
            const prefix = list.ordered ? `${i + 1}. ` : '- ';
            return prefix + item.text;
          })
          .join('\n') + '\n\n'
      );
    }
    case 'code': {
      const code = token as Tokens.Code;
      const lang = code.lang ?? '';
      return '```' + lang + '\n' + code.text + '\n```\n\n';
    }
    case 'blockquote':
      return (
        (token as Tokens.Blockquote).text
          .split('\n')
          .map((line: string) => '> ' + line)
          .join('\n') + '\n\n'
      );
    case 'space':
      return '';
    case 'hr':
      return '---\n\n';
    case 'html':
      return (token as Tokens.HTML).text + '\n\n';
    case 'table': {
      const table = token as Tokens.Table;
      const headerRow = table.header.map((cell) => cell.text).join(' | ');
      const separator = table.header.map(() => '---').join(' | ');
      const bodyRows = table.rows.map((row) => row.map((cell) => cell.text).join(' | '));
      return [headerRow, separator, ...bodyRows].join('\n') + '\n\n';
    }
    default:
      // Fallback: use raw if available
      if ('raw' in token && typeof token.raw === 'string') {
        return token.raw;
      }
      return '';
  }
}

/**
 * Build a nested ParsedSection tree from a flat list of sections.
 * A section at depth N becomes a child of the nearest preceding section
 * at depth N-1.
 */
function buildTree(flatSections: ParsedSection[]): ParsedSection[] {
  const roots: ParsedSection[] = [];
  const stack: ParsedSection[] = [];

  for (const section of flatSections) {
    // Pop stack until we find a parent with lower depth
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
 * Parse markdown content into a nested tree of ParsedSection objects.
 *
 * Uses marked.lexer() to tokenize, then walks the token array to split
 * by heading tokens and collect body content between headings.
 * Returns a tree based on heading depth.
 */
export function parseMarkdown(content: string): ParsedSection[] {
  const tokens = marked.lexer(content);
  const flatSections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;

      // Save previous section
      if (currentSection) {
        currentSection.body = currentSection.body.trim();
        flatSections.push(currentSection);
      }

      currentSection = {
        title: heading.text,
        depth: heading.depth,
        body: '',
        children: [],
      };
    } else if (currentSection) {
      currentSection.body += tokenToText(token);
    }
    // Content before first heading is ignored
  }

  // Push last section
  if (currentSection) {
    currentSection.body = currentSection.body.trim();
    flatSections.push(currentSection);
  }

  return buildTree(flatSections);
}
