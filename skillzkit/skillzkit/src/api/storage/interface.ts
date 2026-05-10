/**
 * CatalogStorage — the seam between the skillzkit API handlers and
 * the underlying persistence. Three implementations:
 *
 *   - **fs** (lib/api/storage/fs.ts) — read-only, points at this repo's
 *     own `catalog.json` + `.claude/` tree. Used by `skillzkit serve`
 *     for local development. Write methods throw.
 *
 *   - **memory** (lib/api/storage/memory.ts) — full read+write, in-process.
 *     Used by tests, and as a default for development.
 *
 *   - **s3** (lib/api/storage/s3.ts) — full read+write, backed by an S3
 *     bucket. Production. Stateless serverless functions (Lambda /
 *     Cloud Run) instantiate this against a configured bucket.
 *
 * Layout in S3 (mirrored conceptually by memory):
 *
 *   v1/index.json                              ← CatalogIndex (latest pointers)
 *   v1/commands/<slug>@<version>.json          ← immutable versioned artifact
 *   v1/skills/<name>@<version>.json
 *   v1/workflows/<qualifiedName>@<version>.json
 *
 * Versioned-promotion model (see TAGS.md / project memory): writes are
 * immutable and land at a specific version path. The index's
 * "currentVersion" pointer is updated only by an explicit promote()
 * call, separating "stored" from "live."
 */

import type {
  CatalogIndex,
  Command,
  Skill,
  Workflow,
} from "../contracts.js";
import type { AuthorIdentity, VersionEntry } from "../contracts.js";

/* ── Read-only surface ────────────────────────────────────────── */

/**
 * The minimum interface the API's read endpoints need. The `fs`
 * backend implements this and nothing else (the local repo is the
 * source of truth — you'd contribute via git, not API).
 */
export interface CatalogReadStorage {
  /** Fetch the catalog index (summaries + currentVersion pointers). */
  getIndex(): Promise<CatalogIndex>;

  /** Fetch the latest promoted version of a command, including body. */
  getCommand(slug: string): Promise<Command | null>;
  getSkill(name: string): Promise<Skill | null>;
  getWorkflow(qualifiedName: string): Promise<Workflow | null>;
}

/* ── Read+write surface ───────────────────────────────────────── */

export interface PutCommandInput {
  command: Command;
  version: string;
  author: AuthorIdentity;
  changelog?: string;
}
export interface PutSkillInput {
  skill: Skill;
  version: string;
  author: AuthorIdentity;
  changelog?: string;
}
export interface PutWorkflowInput {
  workflow: Workflow;
  version: string;
  author: AuthorIdentity;
  changelog?: string;
}

/**
 * Full read+write storage. The contribution endpoint (#5) writes via
 * this; promotion is a separate explicit step so a stored version
 * doesn't go live until a moderator/author opts in.
 */
export interface CatalogStorage extends CatalogReadStorage {
  /* History — every stored version, including unpromoted. */
  listCommandVersions(slug: string): Promise<VersionEntry[]>;
  listSkillVersions(name: string): Promise<VersionEntry[]>;
  listWorkflowVersions(qualifiedName: string): Promise<VersionEntry[]>;

  /* Get a specific version (vs. getCommand which returns the latest
   * promoted version). Returns null if that version doesn't exist. */
  getCommandVersion(slug: string, version: string): Promise<Command | null>;
  getSkillVersion(name: string, version: string): Promise<Skill | null>;
  getWorkflowVersion(
    qualifiedName: string,
    version: string,
  ): Promise<Workflow | null>;

  /* Write a new immutable version. Returns the metadata that was
   * persisted alongside the artifact. Promotion is a separate call —
   * a fresh put() does NOT update the index pointer. */
  putCommand(input: PutCommandInput): Promise<VersionEntry>;
  putSkill(input: PutSkillInput): Promise<VersionEntry>;
  putWorkflow(input: PutWorkflowInput): Promise<VersionEntry>;

  /* Move the index pointer for this slug to a specific stored version.
   * Throws if the version doesn't exist. */
  promoteCommand(slug: string, version: string): Promise<void>;
  promoteSkill(name: string, version: string): Promise<void>;
  promoteWorkflow(qualifiedName: string, version: string): Promise<void>;
}

/* ── Errors ───────────────────────────────────────────────────── */

/**
 * Thrown by put*() when a slug+version combo already exists. Versions
 * are immutable; replacing an existing version is never allowed —
 * authors should bump version instead. Maps to HTTP 409 Conflict at
 * the API layer.
 */
export class VersionConflictError extends Error {
  constructor(
    public readonly slug: string,
    public readonly version: string,
  ) {
    super(`${slug}@${version} already exists — versions are immutable; bump version`);
    this.name = "VersionConflictError";
  }
}

/**
 * Thrown by put*() when the would-be writer's identity doesn't match
 * the recorded author of the slug's existing versions. Maps to HTTP
 * 403 Forbidden at the API layer. (Slug ownership policy: see project
 * memory — author-match-on-update.)
 */
export class AuthorMismatchError extends Error {
  constructor(
    public readonly slug: string,
    public readonly attemptedAuthorId: string,
    public readonly ownerAuthorId: string,
  ) {
    super(
      `${slug} is owned by author ${ownerAuthorId}; cannot publish as ${attemptedAuthorId}`,
    );
    this.name = "AuthorMismatchError";
  }
}

/**
 * Thrown by promote*() when the version doesn't exist in storage.
 * Maps to HTTP 404 at the API layer.
 */
export class VersionNotFoundError extends Error {
  constructor(
    public readonly slug: string,
    public readonly version: string,
  ) {
    super(`${slug}@${version} not found in storage`);
    this.name = "VersionNotFoundError";
  }
}
