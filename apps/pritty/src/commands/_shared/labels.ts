const LABEL_BY_TYPE: Record<string, string> = {
  feat: 'enhancement',
  fix: 'bug',
  docs: 'documentation',
  refactor: 'refactor',
  test: 'testing',
};

/**
 * Labels from conventional-commit types, in order of first appearance. This
 * is the deterministic counterpart of what the AI path is asked to infer, used
 * when the caller supplies the title and body.
 */
export function inferLabels(commits: ReadonlyArray<{ subject: string }>): string[] {
  const out: string[] = [];
  for (const c of commits) {
    const m = c.subject.match(/^([a-z]+)(?:\([^)]*\))?!?:/);
    const label = m ? LABEL_BY_TYPE[m[1]!] : undefined;
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}
