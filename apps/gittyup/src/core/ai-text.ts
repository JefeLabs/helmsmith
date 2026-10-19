import type { ChatCompletionMessage } from '../auth/types.js';
import type { ConflictFile } from '../config/schema.js';

/**
 * Text helpers between the model and the resolution gate: prompt
 * construction, fence handling, and a line diff summary.
 */

const OUTER_FENCE_RE = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/;
const FENCED_BLOCK_RE = /```[^\n]*\n([\s\S]*?)```/g;

/** Remove exactly one ``` wrapper around the whole text; anything else is returned unchanged. */
export function stripOuterFence(text: string): string {
  const m = text.match(OUTER_FENCE_RE);
  if (!m) return text;
  const inner = m[1];
  return inner.endsWith('\n') ? inner : `${inner}\n`;
}

/** The last fenced block in a reply plus the prose before it, or null when there is none. */
export function extractLastFencedBlock(text: string): { rationale: string; code: string } | null {
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(FENCED_BLOCK_RE)) last = m;
  if (!last) return null;
  const code = last[1].endsWith('\n') ? last[1] : `${last[1]}\n`;
  return { rationale: text.slice(0, last.index).trim(), code };
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
  suggest: `${PREAMBLE} Explain your resolution in at most five lines, then output the complete merged file in one fenced code block. The code block must be the last thing in your reply.`,
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
