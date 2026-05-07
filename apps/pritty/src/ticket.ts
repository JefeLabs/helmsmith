/**
 * Ticket detection + optional validation. Reads a regex pattern from
 * config and extracts the first match from the branch name. The AI
 * prompts get enriched with the ticket reference (and link, when a
 * template is configured) so generated commits and PRs include it.
 *
 * Validation is opt-in via `ticket.validate: true`. When set, the
 * command fast-fails if no ticket is detected on the current branch
 * — no interactive prompt, no override flag, just a clear exit
 * message. Teams that need the gate enable it; everyone else gets
 * silent enrichment when the pattern matches and a no-op when it
 * doesn't.
 */

export interface TicketConfig {
  /** Regex source — e.g. `PROJ-\\d+` or `[A-Z]{2,}-\\d+`. */
  pattern: string;
  /** Optional URL template; `{ticket}` is replaced with the match. */
  linkTemplate?: string;
  /** When true, fast-fail if no ticket is detected on the branch. */
  validate?: boolean;
}

/**
 * Find the first ticket-shaped substring in a branch name. Returns
 * null on no match, malformed regex, or empty input. Case-insensitive
 * for typical patterns (Jira keys are uppercase by convention but
 * branch names sometimes downcase them).
 */
export function detectTicket(
  branch: string,
  pattern: string,
): string | null {
  if (!branch) return null;
  try {
    const re = new RegExp(pattern, "i");
    const match = branch.match(re);
    if (!match) return null;
    // Preserve original casing from the branch — uppercase tickets
    // stay uppercase; lowercase get normalized to upper for display.
    return match[0].toUpperCase();
  } catch {
    return null;
  }
}

/**
 * Format a ticket as a URL using the configured template. Returns
 * undefined when no template is set or the ticket is empty. The
 * template uses `{ticket}` as the substitution token.
 */
export function ticketLink(
  ticket: string | null,
  template?: string,
): string | undefined {
  if (!ticket || !template) return undefined;
  return template.replace(/\{ticket\}/g, ticket);
}

/**
 * Build the AI-prompt enrichment text for a detected ticket. Returns
 * empty string when no ticket — caller can concat unconditionally.
 */
export function ticketPromptGuidance(
  ticket: string | null,
  link: string | undefined,
): string {
  if (!ticket) return "";
  const linkText = link ? ` (${link})` : "";
  return `\nReference ticket: ${ticket}${linkText}. Include "Refs: ${ticket}" as a commit footer line, and mention the ticket in any PR body you generate.`;
}
