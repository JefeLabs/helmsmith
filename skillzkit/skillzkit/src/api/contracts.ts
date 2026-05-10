/**
 * REST API wire contracts shared between the server (Hono handlers) and
 * the TUI client. Re-exports the in-memory catalog types from lib/types
 * so the wire format and the in-memory format stay locked together — a
 * single source of truth prevents the classic client/server type drift.
 *
 * Convention: list endpoints return items WITHOUT `body` (the markdown
 * payload, which can dominate response size on a 200-item catalog); get
 * endpoints return the full item including body. The `*Summary` aliases
 * below make this explicit at the type level.
 */

import type {
  Catalog,
  Command,
  Frontmatter,
  ItemKind,
  NextSuggestion,
  Skill,
  Workflow,
} from "../types.js";

export type {
  Catalog,
  Command,
  Frontmatter,
  ItemKind,
  NextSuggestion,
  Skill,
  Workflow,
} from "../types.js";

/* ── Catalog item shapes (server → client) ─────────────────────── */

/** Command minus the body — used in list responses. */
export type CommandSummary = Omit<Command, "body">;
export type SkillSummary = Omit<Skill, "body">;
export type WorkflowSummary = Omit<Workflow, "body">;

/** Full catalog with bodies — used by `GET /catalog` for clients that
 *  want everything in one payload (e.g., TUI cold start). */
export type FullCatalog = Catalog;

/** Lightweight catalog index — same shape as Catalog but item arrays
 *  carry summaries (no bodies). Cheaper to fetch when the client only
 *  needs to render the browse tree and pulls bodies on-demand. */
export interface CatalogIndex {
  version: number;
  generatedAt: string;
  packageVersion: string;
  commands: CommandSummary[];
  skills: SkillSummary[];
  workflows: WorkflowSummary[];
}

/* ── Read endpoint responses ───────────────────────────────────── */

export interface ListCommandsResponse {
  commands: CommandSummary[];
  total: number;
}
export interface ListSkillsResponse {
  skills: SkillSummary[];
  total: number;
}
export interface ListWorkflowsResponse {
  workflows: WorkflowSummary[];
  total: number;
}

export type GetCommandResponse = Command;
export type GetSkillResponse = Skill;
export type GetWorkflowResponse = Workflow;

export interface SearchResponse {
  query: string;
  commands: CommandSummary[];
  skills: SkillSummary[];
  workflows: WorkflowSummary[];
}

export interface SuggestResponse {
  forSlug: string;
  suggestions: NextSuggestion[];
}

export interface HealthResponse {
  status: "ok";
  version: string;
  catalogGeneratedAt: string;
  itemCounts: { commands: number; skills: number; workflows: number };
}

/* ── Read endpoint query filters ───────────────────────────────── */

export interface ListCommandsQuery {
  kind?: ItemKind;
  /** Optional slug prefix filter, e.g. "core:tools:" */
  prefix?: string;
  /** Pagination — for very large catalogs. Defaults to no limit. */
  limit?: number;
  offset?: number;
}

export interface SearchQuery {
  q: string;
  limit?: number;
}

/* ── Contribution write contracts ──────────────────────────────── */

/**
 * Auth context attached to a contribution. The API key (validated by
 * middleware) maps to a stable AuthorIdentity issued by
 * agentx-controlplane. Stored on each artifact so author-match update
 * checks have something to compare against.
 */
export interface AuthorIdentity {
  /** Stable opaque ID from controlplane — survives display-name changes. */
  id: string;
  /** Human-readable name; not used for auth, just attribution. */
  displayName: string;
  /** Email for PR/contribution notifications; optional. */
  email?: string;
}

/**
 * What kind of artifact is being contributed. Skills are explicitly
 * allowed here even though the existing `skillzkit-author` doc reserves
 * skill creation for maintainers — the API can enforce that with an
 * authorization check (role on AuthorIdentity), not a hard-coded gate.
 */
export type ContributionKind = "command" | "workflow" | "skill";

/**
 * One file within a contribution bundle.
 *
 * Commands and workflows submit a single-element array (the .md
 * file). Skills submit `SKILL.md` (required) plus any companion
 * files — markdown documentation, scripts, structured config — that
 * the skill references at runtime.
 */
export interface ContributionFile {
  /** Relative path within the bundle, e.g. "SKILL.md" or
   *  "scripts/runner.py". No leading slash, no `..` segments —
   *  validated server-side. */
  path: string;
  /** UTF-8 text content. Binary files are not supported. */
  content: string;
}

export interface CreateContributionRequest {
  kind: ContributionKind;
  /** Slash-command slug (commands/workflows) OR skill name (skills). */
  slug: string;
  /**
   * Frontmatter from the primary file (for skills: SKILL.md). Parsed
   * and forwarded by the client. The server re-validates structurally
   * — clients are not trusted to enforce the catalog's schema.
   */
  frontmatter: Frontmatter;
  /**
   * All files in the contribution bundle. For commands and workflows
   * this is exactly one entry (the .md file). For skills this MUST
   * include `SKILL.md` and MAY include companion files.
   */
  files: ContributionFile[];
  /** Optional — semver bump hint for the next version. Defaults to
   *  monotonic increment from latest existing version. */
  versionBump?: "major" | "minor" | "patch";
  /** Optional message describing the change — surfaces in version
   *  history and any moderation UI. */
  changelog?: string;
}

/**
 * Lifecycle state of a contribution. Without layer-3 review enabled,
 * a successful POST goes straight to `accepted` (or `pending` if not
 * yet promoted). With review enabled, the path is
 * `pending → reviewing → accepted | rejected`. Promotion is a
 * separate explicit step regardless — `promoted` means the catalog
 * index points at this version as the "live" one.
 */
export type ContributionStatus =
  | "pending"
  | "reviewing"
  | "accepted"
  | "rejected"
  | "promoted";

/**
 * A single finding produced by the layer-3 agent reviewer or the
 * deterministic layer-2 file scan. `axis` distinguishes what kind of
 * concern was flagged so the UI can group findings; `severity` drives
 * the block/allow decision (high = block, medium = warn, low = info).
 *
 * `fileRef` points at the offending file path within the bundle when
 * the finding is file-scoped; absent for whole-bundle concerns
 * (e.g., a quality finding that applies to the entire submission).
 */
export interface ReviewFinding {
  severity: "low" | "medium" | "high";
  axis: "structural" | "bundle" | "quality" | "tag-fit" | "safety";
  message: string;
  fileRef?: string;
}

/**
 * Result of running validation across all enabled layers. `passed`
 * is the convenience boolean: true if there are no findings at or
 * above the configured blocking threshold (default: high).
 *
 * `version` is filled in by the server when the contribution passes
 * layers 1+2 and is durably stored; `id` is the contribution id used
 * for status polling on the async (review-enabled) path.
 */
export interface ContributionResponse {
  id: string;
  slug: string;
  kind: ContributionKind;
  status: ContributionStatus;
  /** Set once the artifact is durably stored. Absent on rejected. */
  version?: string;
  /** Whether this version is the catalog index's current pointer. */
  promoted: boolean;
  /** Author identity recorded for this contribution. */
  author: AuthorIdentity;
  /** Layer-1/2/3 findings accumulated during validation. */
  findings: ReviewFinding[];
  createdAt: string;
}

/**
 * One row in the version history of a slug. Same shape used by the
 * storage layer (CatalogStorage.listCommandVersions etc.) and by the
 * API's ListVersionsResponse — keeping it as one type prevents drift
 * between persisted history and the wire contract.
 */
export interface VersionEntry {
  version: string;
  author: AuthorIdentity;
  createdAt: string;
  promoted: boolean;
  changelog?: string;
}

export interface ListVersionsResponse {
  slug: string;
  kind: ContributionKind;
  versions: VersionEntry[];
}

export interface PromoteVersionRequest {
  version: string;
}

/* ── Error envelope ───────────────────────────────────────────── */

/**
 * Uniform error shape for every non-2xx response. `code` is a stable
 * machine-readable string (clients should switch on this); `message`
 * is human-readable; `details` is free-form and only present for
 * validation errors (field-level breakdowns).
 */
export interface ApiError {
  code:
    | "validation_failed"
    | "slug_conflict"
    | "author_mismatch"
    | "not_found"
    | "unauthorized"
    | "forbidden"
    | "internal_error";
  message: string;
  details?: Record<string, unknown>;
}

/* ── Convenience: strip body for list responses ────────────────── */

export function toCommandSummary(c: Command): CommandSummary {
  const { body: _body, ...rest } = c;
  return rest;
}
export function toSkillSummary(s: Skill): SkillSummary {
  const { body: _body, ...rest } = s;
  return rest;
}
export function toWorkflowSummary(w: Workflow): WorkflowSummary {
  const { body: _body, ...rest } = w;
  return rest;
}
