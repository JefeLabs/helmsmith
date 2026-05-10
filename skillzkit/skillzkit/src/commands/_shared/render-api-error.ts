import { SkillzkitApiError } from '../../api/client.js';
import type { ReviewFinding } from '../../api/contracts.js';

/**
 * Pretty-print a SkillzkitApiError to stderr with code-aware
 * remediation hints. Used by both `skillzkit contribute` (CLI) and
 * the TUI's post-`n` contribute flow.
 *
 * - validation_failed: groups findings by severity (high/medium/low)
 *   with axis + message + optional fileRef
 * - author_mismatch: surfaces the slug owner so the user can
 *   coordinate or pick a different slug
 * - slug_conflict: suggests --bump
 * - unauthorized: points at re-init
 * - network_error: points at config apiUrl
 */
export function renderApiError(err: SkillzkitApiError): void {
  console.error(`✗ ${err.message}`);
  if (err.code === 'validation_failed') {
    const findings = (err.details as { findings?: ReviewFinding[] } | undefined)?.findings;
    if (findings && findings.length > 0) {
      console.error('');
      console.error('Validation findings:');
      const bySeverity: Record<string, ReviewFinding[]> = {
        high: [],
        medium: [],
        low: [],
      };
      for (const f of findings) bySeverity[f.severity]?.push(f);
      for (const sev of ['high', 'medium', 'low'] as const) {
        const items = bySeverity[sev];
        if (items.length === 0) continue;
        console.error(`  ${sev.toUpperCase()} (${items.length}):`);
        for (const f of items) {
          const ref = f.fileRef ? ` [${f.fileRef}]` : '';
          console.error(`    - ${f.axis}: ${f.message}${ref}`);
        }
      }
    }
  } else if (err.code === 'author_mismatch') {
    const owner = (err.details as { ownerAuthorId?: string } | undefined)?.ownerAuthorId;
    if (owner) {
      console.error(`  Slug owner: ${owner}`);
    }
  } else if (err.code === 'slug_conflict') {
    console.error('  Bump the version (--bump major|minor|patch) and try again.');
  } else if (err.code === 'unauthorized') {
    console.error('  Check your API key and PIN. Re-run `skillzkit init` to re-authenticate.');
  } else if (err.code === 'network_error') {
    console.error(
      '  Check connectivity, or run `skillzkit config apiUrl <url>` if the URL changed.',
    );
  }
}
