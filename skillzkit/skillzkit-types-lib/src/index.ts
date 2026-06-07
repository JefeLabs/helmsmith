/**
 * @ecruz165/skillzkit-types
 *
 * **Source of truth** for the skillzkit catalog shape. JSDoc tags
 * (`@pattern`, `@format`, `@minimum`, etc.) are picked up by
 * `ts-json-schema-generator` to produce the canonical
 * `apps/skillzkit/schema/catalog.schema.json` — that JSON Schema in
 * turn drives Java POJO codegen on agentx-platform's side via
 * `jsonschema2pojo`.
 *
 * Pipeline:
 *
 *   src/index.ts (this file)
 *      ↓ ts-json-schema-generator (npm run build:schema)
 *   apps/skillzkit/schema/catalog.schema.json
 *      ↓ jsonschema2pojo (in agentx-platform CI)
 *   Java POJOs
 *
 * Zero runtime deps. Consumed by:
 *   - `@ecruz165/skillzkit` (this repo) — internally
 *   - `agentx-platform/packages/controlplane-ui` — for rendering catalog data
 */

/** Distinguishes runnable commands, multi-phase workflows, and context-only artifacts. */
export type ItemKind = 'command' | 'workflow' | 'context';

/** Invocation interface a tool/integration supports. */
export type Interface = 'cli' | 'mcp' | 'rest';

/**
 * Arbitrary YAML frontmatter from the source `.md` file. The schema
 * intentionally does not lock this down without forking per-kind
 * frontmatter contracts; treat unknown keys as forward-compatible.
 *
 * @additionalProperties true
 */
export interface Frontmatter {
  [key: string]: unknown;
}

export interface Command {
  /**
   * Slash-command form, e.g. `"core:tools:npm"`. Each colon-separated
   * segment is lowercase kebab-case.
   *
   * @pattern ^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$
   */
  slug: string;
  /** Filesystem path relative to `.claude/commands/`, e.g. `"core/tools/npm.md"`. */
  path: string;
  kind: ItemKind;
  /**
   * Imperative action-phrase describing what this command produces.
   * UI prefers this over slug; falls back to slug when absent.
   */
  outcome?: string;
  description: string;
  /** Free-form hint shown in CLI help, e.g. `"<package-name>"`. */
  argumentHint?: string;
  /** Tool names the command is allowed to invoke, e.g. `["Bash", "Read", "Edit"]`. */
  allowedTools?: string[];
  /** Slash-command slugs referenced in this item's body. Computed at catalog-build time. */
  references: string[];
  /** Inverse of `references`. Computed at catalog-build time. */
  referencedBy: string[];
  /**
   * Artifact paths/globs this command needs to exist before it runs,
   * declared in frontmatter (e.g. `["product/.pencil-brand.json"]`).
   * Drives the build-order graph — distinct from `references` (which is
   * "mentions /slug in prose"); `requires` is "needs this artifact".
   */
  requires?: string[];
  /**
   * Artifact paths/globs this command creates, declared in frontmatter
   * (e.g. `["design/foundations/*.pen"]`). A command B `dependsOn` A
   * when one of A's `produces` satisfies one of B's `requires`.
   */
  produces?: string[];
  /**
   * Command slugs that must run first — those whose `produces` satisfy
   * this command's `requires`. Computed at catalog-build time; a
   * topological sort over this edge set yields build order.
   */
  dependsOn: string[];
  /** Inverse of `dependsOn`. Computed at catalog-build time. */
  dependents: string[];
  /**
   * Orthogonal discovery metadata. Two-tier: curated `core` tags
   * (TAGS.md) plus free-form `extension` tags.
   */
  tags?: string[];
  /** Full markdown body of the source `.md` file (no frontmatter). */
  body: string;
  frontmatter: Frontmatter;
}

export interface Skill {
  /** Skill name from frontmatter, e.g. `"skillzkit-product-router"`. */
  name: string;
  /** Filesystem path relative to `.claude/skills/`. */
  path: string;
  description: string;
  references: string[];
  tags?: string[];
  body: string;
  frontmatter: Frontmatter;
}

export interface Workflow {
  /** Qualified name used by `/core:workflows:manage`, e.g. `"product:greenfield"`. */
  qualifiedName: string;
  /** Domain prefix, e.g. `"product"`, `"engineer"`, `"market"`. */
  domain: string;
  /** Workflow slug within its domain, e.g. `"greenfield"`. */
  slug: string;
  /** Underlying command slug for direct invocation. */
  commandSlug: string;
  /** Imperative action-phrase describing the workflow's outcome. */
  outcome?: string;
  description: string;
  /** Free-form duration estimate, e.g. `"2-4 hours"` or `"1 week"`. */
  estimatedDuration?: string;
  /** @minimum 1 */
  phases?: number;
  prerequisites?: string[];
  references: string[];
  tags?: string[];
  body: string;
  frontmatter: Frontmatter;
}

/**
 * The full catalog produced by `skillzkit catalog`. The JSON Schema
 * generated from this type is the cross-language contract — TS
 * consumers import these types directly; Java consumers read the
 * generated schema and produce POJOs.
 */
export interface Catalog {
  /**
   * Catalog format version. Incremented on breaking shape changes.
   *
   * @minimum 1
   */
  version: number;
  /**
   * ISO-8601 timestamp of catalog generation.
   *
   * @format date-time
   */
  generatedAt: string;
  /** Semver of the skillzkit package that produced this catalog. */
  packageVersion: string;
  commands: Command[];
  skills: Skill[];
  workflows: Workflow[];
}
