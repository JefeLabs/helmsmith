/**
 * Detect a GitHub-convention pull-request template in the repo.
 * Resolution order (first match wins) per GitHub docs:
 *
 *   .github/PULL_REQUEST_TEMPLATE.md
 *   .github/pull_request_template.md
 *   PULL_REQUEST_TEMPLATE.md
 *   pull_request_template.md
 *   docs/PULL_REQUEST_TEMPLATE.md
 *   docs/pull_request_template.md
 *
 * When found, the template's content is fed into the AI prompt as
 * authoritative structure for the PR body. Pritty doesn't define a
 * template format — it consumes whatever the repo already has.
 *
 * Multi-template support (`.github/PULL_REQUEST_TEMPLATE/<name>.md`)
 * is intentionally out of scope for v1; selection logic + branch
 * mapping is its own design problem.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Hard cap so a runaway template doesn't dominate the AI context window. */
const MAX_TEMPLATE_BYTES = 8_000;

/** GitHub-recognized paths in priority order. */
const TEMPLATE_PATHS: ReadonlyArray<string> = [
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
];

export interface PullRequestTemplate {
  /** Repo-relative path the template was loaded from. */
  path: string;
  /** Raw template content (truncated to MAX_TEMPLATE_BYTES if oversized). */
  content: string;
  /** True when the original file exceeded MAX_TEMPLATE_BYTES. */
  truncated: boolean;
}

/**
 * Walk the GitHub priority list and return the first existing
 * template, or null if none found. Read errors (permissions, etc.)
 * are silently skipped — pritty falls back to its default body
 * structure.
 */
export function findPullRequestTemplate(cwd: string = process.cwd()): PullRequestTemplate | null {
  for (const rel of TEMPLATE_PATHS) {
    const full = join(cwd, rel);
    if (!existsSync(full)) continue;
    try {
      const raw = readFileSync(full, 'utf8');
      const truncated = raw.length > MAX_TEMPLATE_BYTES;
      const content = truncated ? raw.slice(0, MAX_TEMPLATE_BYTES) : raw;
      return { path: rel, content, truncated };
    } catch {}
  }
  return null;
}

/**
 * Build the AI-prompt enrichment text for a detected template.
 * Empty string when no template — caller can concat unconditionally.
 */
export function templatePromptGuidance(template: PullRequestTemplate | null): string {
  if (!template) return '';
  return [
    '',
    'Use the following PR template as the structure for the `body` field.',
    'Keep the existing section headings. Fill in placeholder text, comment blocks (<!-- ... -->),',
    'and unchecked checkboxes with your generated content. Do not invent headings beyond the template.',
    'Drop sections that are clearly not applicable rather than padding them with filler.',
    '',
    '```markdown',
    template.content,
    '```',
  ].join('\n');
}
