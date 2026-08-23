/**
 * Bot-author detection. Bots (dependabot, renovate, CI) inflate volume metrics and
 * must never appear in scorecards or segment cohorts.
 */
export function isBotAuthor(name: string, email: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const hay = `${name}\n${email}`.toLowerCase();
  return patterns.some((p) => p && hay.includes(p.toLowerCase()));
}

export function excludeBots<T extends { member: string; email: string }>(
  records: T[],
  patterns: string[],
): T[] {
  if (patterns.length === 0) return records;
  return records.filter((r) => !isBotAuthor(r.member, r.email, patterns));
}
