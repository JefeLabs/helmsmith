export type ItemKind = "command" | "workflow" | "context";

export interface Frontmatter {
  [key: string]: unknown;
}

export interface Command {
  /** Slash-command form, e.g. "core:tools:npm" */
  slug: string;
  /** Filesystem path relative to .claude/commands/, e.g. "core/tools/npm.md" */
  path: string;
  kind: ItemKind;
  /**
   * Action-phrase that names what this command produces — same format as
   * Workflow.outcome. Per the Task/Workflow contract, every runnable
   * command should declare one. UI labels prefer outcome over slug; falls
   * back to slug when absent (so legacy commands keep rendering).
   */
  outcome?: string;
  description: string;
  argumentHint?: string;
  allowedTools?: string[];
  /**
   * Slash commands referenced in this item's body, e.g.
   * `["core:tools:npm", "core:integrations:figma"]`.
   * Used to derive the dependency graph for cascade selection.
   */
  references: string[];
  /**
   * Inverse of `references` — slugs of items whose body mentions this one.
   * Computed at catalog-build time so consumers (CLI suggest, agents
   * reading catalog.json directly) can answer "what builds on X?"
   * without re-traversing every body.
   */
  referencedBy: string[];
  /**
   * Orthogonal discovery metadata — used by `skillzkit search` and
   * `skillzkit list --tag <name>` to find artifacts across persona AND
   * topic boundaries. Tags do NOT affect router membership or install
   * cascade; the slug's path stays the only structural identity. A tag
   * like "accessibility" can legitimately appear on commands in
   * product:design:*, product:ux:*, engineer:architecture:*, and
   * engineer:maintenance:* simultaneously — each artifact still owns
   * its own persona-specific framing. Governed two-tier: a curated
   * "core" set in TAGS.md plus free-form "extension" tags flagged by
   * doctor for visibility.
   */
  tags?: string[];
  body: string;
  frontmatter: Frontmatter;
}

export interface Skill {
  /** Skill name from frontmatter, e.g. "skillzkit-product-router" */
  name: string;
  /** Filesystem path relative to .claude/skills/ */
  path: string;
  description: string;
  /** Slash commands referenced in this skill's body */
  references: string[];
  /** See Command.tags — same orthogonal discovery role for skills. */
  tags?: string[];
  body: string;
  frontmatter: Frontmatter;
}

export interface Workflow {
  /** Qualified name used by /core:workflows:manage, e.g. "product:greenfield" */
  qualifiedName: string;
  /** Domain prefix, e.g. "product", "engineer", "market" */
  domain: string;
  /** Workflow slug, e.g. "greenfield" */
  slug: string;
  /** Underlying command slug for direct invocation */
  commandSlug: string;
  /**
   * Action-phrase that names the workflow's outcome, e.g. "Apply a brand
   * refresh" / "Set up a new design system". Format: imperative verb +
   * outcome event/noun. UI labels (TUI rows, manage list output) prefer
   * this over the slug; falls back to the slug if absent.
   */
  outcome?: string;
  description: string;
  estimatedDuration?: string;
  phases?: number;
  prerequisites?: string[];
  /** Slash commands referenced in this workflow's body */
  references: string[];
  /** See Command.tags — workflow tags are inherited from the underlying
   *  command's frontmatter at catalog-build time. */
  tags?: string[];
  body: string;
  frontmatter: Frontmatter;
}

export interface Catalog {
  version: number;
  generatedAt: string;
  packageVersion: string;
  commands: Command[];
  skills: Skill[];
  workflows: Workflow[];
}

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
  | "consumes-X" // candidate's body references the completed slug
  | "wraps-X" // candidate is a workflow whose body references the completed slug
  | "next-in-active-workflow"; // positional next step in the active workflow

export interface NextSuggestion {
  slug: string;
  kind: "command" | "workflow";
  reason: NextReason;
  score: number;
  rationale: string;
}
