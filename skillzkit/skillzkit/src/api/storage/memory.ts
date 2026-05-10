/**
 * In-memory CatalogStorage implementation.
 *
 * Used by tests (predictable, fast, no IO) and as a sane default for
 * development workflows that don't want filesystem or S3 wiring. The
 * memory-backed maps mirror the conceptual S3 layout exactly:
 *
 *   commandVersions: Map<slug, StoredEntry<Command>[]>
 *   skillVersions: Map<name, StoredEntry<Skill>[]>
 *   workflowVersions: Map<qualifiedName, StoredEntry<Workflow>[]>
 *
 * Each StoredEntry pairs an artifact with its VersionEntry metadata
 * (version, author, createdAt, promoted, changelog). Newest entry
 * is always last in the list. Promotion just toggles the `promoted`
 * flag on the chosen entry and clears it on every other entry for
 * that slug.
 */

import type {
  CatalogIndex,
  Command,
  CommandSummary,
  Skill,
  SkillSummary,
  Workflow,
  WorkflowSummary,
} from "../contracts.js";
import {
  toCommandSummary,
  toSkillSummary,
  toWorkflowSummary,
} from "../contracts.js";
import type { AuthorIdentity, VersionEntry } from "../contracts.js";
import {
  AuthorMismatchError,
  type CatalogStorage,
  type PutCommandInput,
  type PutSkillInput,
  type PutWorkflowInput,
  VersionConflictError,
  VersionNotFoundError,
} from "./interface.js";

interface StoredEntry<T> {
  artifact: T;
  metadata: VersionEntry;
}

export class MemoryCatalogStorage implements CatalogStorage {
  private commandVersions = new Map<string, StoredEntry<Command>[]>();
  private skillVersions = new Map<string, StoredEntry<Skill>[]>();
  private workflowVersions = new Map<string, StoredEntry<Workflow>[]>();

  constructor(
    /** Package version reported in the index. Defaults to "0.0.0" if
     *  not provided — useful for tests where it doesn't matter. */
    private readonly packageVersion: string = "0.0.0",
  ) {}

  /* ── Read ────────────────────────────────────────────────────── */

  async getIndex(): Promise<CatalogIndex> {
    const commands: CommandSummary[] = [];
    for (const versions of this.commandVersions.values()) {
      const promoted = versions.find((v) => v.metadata.promoted);
      if (promoted) commands.push(toCommandSummary(promoted.artifact));
    }
    const skills: SkillSummary[] = [];
    for (const versions of this.skillVersions.values()) {
      const promoted = versions.find((v) => v.metadata.promoted);
      if (promoted) skills.push(toSkillSummary(promoted.artifact));
    }
    const workflows: WorkflowSummary[] = [];
    for (const versions of this.workflowVersions.values()) {
      const promoted = versions.find((v) => v.metadata.promoted);
      if (promoted) workflows.push(toWorkflowSummary(promoted.artifact));
    }
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      packageVersion: this.packageVersion,
      commands,
      skills,
      workflows,
    };
  }

  async getCommand(slug: string): Promise<Command | null> {
    return getPromoted(this.commandVersions.get(slug));
  }
  async getSkill(name: string): Promise<Skill | null> {
    return getPromoted(this.skillVersions.get(name));
  }
  async getWorkflow(qualifiedName: string): Promise<Workflow | null> {
    return getPromoted(this.workflowVersions.get(qualifiedName));
  }

  async getCommandVersion(slug: string, version: string): Promise<Command | null> {
    return findVersion(this.commandVersions.get(slug), version);
  }
  async getSkillVersion(name: string, version: string): Promise<Skill | null> {
    return findVersion(this.skillVersions.get(name), version);
  }
  async getWorkflowVersion(
    qualifiedName: string,
    version: string,
  ): Promise<Workflow | null> {
    return findVersion(this.workflowVersions.get(qualifiedName), version);
  }

  async listCommandVersions(slug: string): Promise<VersionEntry[]> {
    return listMetadata(this.commandVersions.get(slug));
  }
  async listSkillVersions(name: string): Promise<VersionEntry[]> {
    return listMetadata(this.skillVersions.get(name));
  }
  async listWorkflowVersions(qualifiedName: string): Promise<VersionEntry[]> {
    return listMetadata(this.workflowVersions.get(qualifiedName));
  }

  /* ── Write ───────────────────────────────────────────────────── */

  async putCommand(input: PutCommandInput): Promise<VersionEntry> {
    return this.putGeneric(
      this.commandVersions,
      input.command.slug,
      input.command,
      input.version,
      input.author,
      input.changelog,
    );
  }
  async putSkill(input: PutSkillInput): Promise<VersionEntry> {
    return this.putGeneric(
      this.skillVersions,
      input.skill.name,
      input.skill,
      input.version,
      input.author,
      input.changelog,
    );
  }
  async putWorkflow(input: PutWorkflowInput): Promise<VersionEntry> {
    return this.putGeneric(
      this.workflowVersions,
      input.workflow.qualifiedName,
      input.workflow,
      input.version,
      input.author,
      input.changelog,
    );
  }

  async promoteCommand(slug: string, version: string): Promise<void> {
    promote(this.commandVersions.get(slug), slug, version);
  }
  async promoteSkill(name: string, version: string): Promise<void> {
    promote(this.skillVersions.get(name), name, version);
  }
  async promoteWorkflow(
    qualifiedName: string,
    version: string,
  ): Promise<void> {
    promote(this.workflowVersions.get(qualifiedName), qualifiedName, version);
  }

  /* ── Internal ───────────────────────────────────────────────── */

  /**
   * Common put implementation across all three artifact kinds.
   * Enforces:
   *   - Versions are immutable: `(slug, version)` already in the list
   *     ⇒ VersionConflictError.
   *   - Author-match-on-update: the slug's first publisher owns it;
   *     any subsequent put with a different `author.id` is rejected
   *     with AuthorMismatchError. (Display name + email are mutable;
   *     only the stable id is checked.)
   *   - Fresh puts land with `promoted: false` — promotion is a
   *     separate explicit call, so a contribution doesn't go live
   *     until opted in.
   */
  private putGeneric<T>(
    map: Map<string, StoredEntry<T>[]>,
    key: string,
    artifact: T,
    version: string,
    author: AuthorIdentity,
    changelog: string | undefined,
  ): VersionEntry {
    const existing = map.get(key);
    if (existing) {
      const owner = existing[0].metadata.author;
      if (owner.id !== author.id) {
        throw new AuthorMismatchError(key, author.id, owner.id);
      }
      if (existing.some((e) => e.metadata.version === version)) {
        throw new VersionConflictError(key, version);
      }
    }
    const metadata: VersionEntry = {
      version,
      author,
      createdAt: new Date().toISOString(),
      promoted: false,
      changelog,
    };
    const entry: StoredEntry<T> = { artifact, metadata };
    if (existing) existing.push(entry);
    else map.set(key, [entry]);
    return metadata;
  }
}

/* ── module helpers ───────────────────────────────────────────── */

function getPromoted<T>(entries: StoredEntry<T>[] | undefined): T | null {
  if (!entries) return null;
  const promoted = entries.find((e) => e.metadata.promoted);
  return promoted ? promoted.artifact : null;
}

function findVersion<T>(
  entries: StoredEntry<T>[] | undefined,
  version: string,
): T | null {
  if (!entries) return null;
  const match = entries.find((e) => e.metadata.version === version);
  return match ? match.artifact : null;
}

function listMetadata<T>(
  entries: StoredEntry<T>[] | undefined,
): VersionEntry[] {
  return entries ? entries.map((e) => ({ ...e.metadata })) : [];
}

function promote<T>(
  entries: StoredEntry<T>[] | undefined,
  key: string,
  version: string,
): void {
  if (!entries) throw new VersionNotFoundError(key, version);
  const target = entries.find((e) => e.metadata.version === version);
  if (!target) throw new VersionNotFoundError(key, version);
  for (const entry of entries) {
    entry.metadata.promoted = entry === target;
  }
}
