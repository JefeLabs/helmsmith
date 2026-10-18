/**
 * Attribution lines come from configuration, not from whoever wrote the
 * words, so they are applied last and idempotently: running pritty twice over
 * the same text, or updating a PR body that already carries the footer, never
 * duplicates them.
 */

const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*: .+$/;

/** Append `trailers` to a commit message, joining an existing trailer block when the message ends with one. */
export function applyTrailers(message: string, trailers: readonly string[]): string {
  const missing = trailers.filter((t) => !message.split('\n').some((l) => l.trim() === t.trim()));
  if (missing.length === 0) return message;
  const trimmed = message.replace(/\s+$/, '');
  const lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
  const hasBlock = trimmed.includes('\n') && TRAILER_LINE.test(lastLine);
  return `${trimmed}${hasBlock ? '\n' : '\n\n'}${missing.join('\n')}`;
}

/** Append `footer` to a body as its last paragraph, removing an earlier copy first. */
export function applyFooter(body: string, footer: string | undefined): string {
  if (!footer || footer.trim().length === 0) return body;
  const needle = footer.trim();
  const without = body
    .split('\n')
    .filter((l) => l.trim() !== needle)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
  return without.length === 0 ? needle : `${without}\n\n${needle}`;
}
