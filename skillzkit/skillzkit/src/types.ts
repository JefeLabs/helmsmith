/**
 * Domain types for skillzkit's catalog. Re-exported from
 * `@jefelabs/skillzkit-types` (the cross-language source of truth that
 * generates `apps/skillzkit/schema/catalog.schema.json` for Java
 * consumers on agentx-platform).
 *
 * Skillzkit-internal types (NextSuggestion, NextReason — used only by
 * the suggest command) stay below.
 */

export type {
  Catalog,
  Command,
  Frontmatter,
  ItemKind,
  Skill,
  Workflow,
} from '@jefelabs/skillzkit-types';

/**
 * One suggested next-step for a completed slug. Returned by
 * `suggestNext()` and printed by `skillzkit suggest`.
 *
 * `kind` distinguishes a single-shot task (run once, reports done) from
 * a workflow (multi-phase, persists state). Surfacing this lets the
 * caller decide whether to commit to a long-running thing or pick a
 * quick follow-up.
 *
 * `reason` is the structural relationship that produced this candidate;
 * `rationale` is the human-readable form of the same fact, ready to
 * print or hand to an agent.
 */
export type NextReason =
  | 'consumes-X' // candidate's body references the completed slug
  | 'wraps-X' // candidate is a workflow whose body references the completed slug
  | 'next-in-active-workflow'; // positional next step in the active workflow

export interface NextSuggestion {
  slug: string;
  kind: 'command' | 'workflow';
  reason: NextReason;
  score: number;
  rationale: string;
}
