import type { ChatCompletionMessage } from '../auth/types.js';
import type { ConflictFile } from '../config/schema.js';

/**
 * Text helpers between the model and the resolution gate: prompt
 * construction, fence handling, and a line diff summary.
 */

/**
 * CommonMark-style fence scanning, line-anchored: an opener of N backticks
 * (or tildes) closes only on a line of at least N of the same character
 * and nothing else. Regex pairing would split a Markdown file at its own
 * ``` blocks, which is how a fragment could slip past the gate.
 */
interface FencedBlock {
  /** index of the opening fence line */
  open: number;
  /** index of the closing fence line */
  close: number;
  /** content lines between the fences */
  lines: string[];
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;

function scanFences(lines: string[]): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].replace(/\r$/, '').match(FENCE_OPEN_RE);
    if (!m) {
      i++;
      continue;
    }
    const fence = m[1];
    const closeRe = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j].replace(/\r$/, ''))) j++;
    if (j >= lines.length) break; // unclosed: not a block
    blocks.push({ open: i, close: j, lines: lines.slice(i + 1, j) });
    i = j + 1;
  }
  return blocks;
}

function joinLines(lines: string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** Remove exactly one fence wrapper around the whole text; anything else is returned unchanged. */
export function stripOuterFence(text: string): string {
  const lines = text.split('\n');
  let first = 0;
  while (first < lines.length && lines[first].trim() === '') first++;
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last--;
  if (first >= last) return text;
  const [block] = scanFences(lines.slice(first, last + 1));
  if (block?.open !== 0 || block.close !== last - first) return text;
  return joinLines(block.lines);
}

/** The last closed fenced block in a reply plus the prose before it, or null when there is none. */
export function extractLastFencedBlock(text: string): { rationale: string; code: string } | null {
  const lines = text.split('\n');
  const blocks = scanFences(lines);
  const last = blocks.at(-1);
  if (!last) return null;
  return { rationale: lines.slice(0, last.open).join('\n').trim(), code: joinLines(last.lines) };
}

/** Approximate line diff: a multiset difference, not an alignment. */
export function diffStat(before: string, after: string): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const line of lines(before)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of lines(after)) {
    const n = counts.get(line) ?? 0;
    if (n > 0) counts.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of counts.values()) removed += n;
  return { added, removed };
}

const PREAMBLE =
  'You are a git merge conflict resolver. You receive the complete OURS, THEIRS and (when available) BASE versions of one file plus the conflicted working copy with markers.';

const SYSTEM: Record<'auto' | 'suggest', string> = {
  auto: `${PREAMBLE} Output the complete merged file and nothing else: no explanation, no code fence.`,
  suggest: `${PREAMBLE} Explain your resolution in at most five lines, then output the complete merged file in one fenced code block opened and closed with four backticks (\`\`\`\`), so any three-backtick fence inside the file does not end the block. The code block must be the last thing in your reply.`,
};

/** System + user messages for one conflicted file. */
export function buildAiMessages(
  file: ConflictFile,
  mode: 'auto' | 'suggest',
): ChatCompletionMessage[] {
  const side = (s: string | undefined) => s ?? '(deleted on this side)';
  const sections = [
    `File: ${file.path}`,
    '',
    '=== OURS (complete file) ===',
    side(file.ours),
    '',
    '=== THEIRS (complete file) ===',
    side(file.theirs),
  ];
  if (file.base !== undefined) sections.push('', '=== BASE (complete file) ===', file.base);
  sections.push('', '=== CONFLICTED WORKING COPY ===', file.markedContent);

  return [
    { role: 'system', content: SYSTEM[mode] },
    { role: 'user', content: sections.join('\n') },
  ];
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
}
