import type { ConflictFile } from '../config/schema.js';

/**
 * The gate every conflict resolution passes before it is written.
 * It cannot prove a merge is right; it refuses the three outcomes that
 * are always wrong: leftover markers, an empty file where both sides had
 * content, and a single line where both sides were multi-line (the
 * signature of a hunk fragment written as the whole file).
 */

export type GateVerdict = { ok: true } | { ok: false; reason: string };

/**
 * A leftover conflict marker at the start of a line.
 *
 * Matches the *opening* (`<<<<<<<`), *base* (`|||||||`) and *closing* (`>>>>>>>`)
 * markers only — never a lone `=======` separator, which is indistinguishable from a
 * Setext/RST heading underline and which git never leaves without the surrounding
 * `<<<<<<<`/`>>>>>>>` (G18). Seven-or-more of the character so a non-default
 * `conflict-marker-size` is still caught (G7). git always writes a space and a label
 * after these three, but a bare marker at end-of-line is accepted as one too.
 */
export const MARKER_RE = /^(?:<{7,}|>{7,}|\|{7,})(?: |\t|\r|$)/m;

export function checkResolution(
  content: string,
  file: Pick<ConflictFile, 'ours' | 'theirs'>,
): GateVerdict {
  if (MARKER_RE.test(content)) {
    return { ok: false, reason: 'still contains conflict markers' };
  }

  const oursHas = hasContent(file.ours);
  const theirsHas = hasContent(file.theirs);
  if (content.trim() === '' && oursHas && theirsHas) {
    return { ok: false, reason: 'empty resolution while both sides have content' };
  }

  if (lineCount(content) <= 1 && isMultiLine(file.ours) && isMultiLine(file.theirs)) {
    return { ok: false, reason: 'single line where both sides are multi-line' };
  }

  return { ok: true };
}

export class ResolutionRejected extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`Resolution for ${path} rejected: ${reason}`);
    this.name = 'ResolutionRejected';
  }
}

function hasContent(side: string | undefined): boolean {
  return typeof side === 'string' && side.length > 0;
}

function lineCount(text: string): number {
  return text.split(/\r?\n/).filter(Boolean).length;
}

function isMultiLine(side: string | undefined): boolean {
  return typeof side === 'string' && lineCount(side) > 1;
}
