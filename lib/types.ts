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
