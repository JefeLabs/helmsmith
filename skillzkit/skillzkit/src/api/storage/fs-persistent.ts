/**
 * Filesystem-persistent CatalogStorage. Read+write storage backed by
 * a directory tree - the simplest writable backend, suited for the
 * controlplane Docker hosting story (mount a Docker volume at the
 * configured root and contributions persist across container
 * restarts).
 *
 * Disk layout under `<root>`:
 *
 *   registry.json
 *   commands/<encoded-slug>@<version>.json
 *   skills/<encoded-slug>@<version>.json
 *   workflows/<encoded-slug>@<version>.json
 *
 * Slug encoding: colons (`:`) are replaced with `__` because some
 * filesystems (Windows, certain network mounts) reject `:` in
 * filenames. Slugs use only `[a-z0-9-:]` so `__` is unambiguous.
 *
 * The registry holds per-slug metadata (owner author id, version
 * history, current version pointer, summary of the promoted version).
 * Individual artifact files hold the full Command/Skill/Workflow
 * object including body. `getIndex` reads only the registry; reading
 * an artifact body requires the per-version file.
 *
 * Concurrency model: this implementation serializes all mutations
 * through a single in-process Promise queue. That's sufficient for
 * single-container Bun deploys (the primary controlplane Docker use
 * case). For multi-instance deploys, swap in a backend with a real
 * distributed lock (Postgres backend) or single-writer pattern (S3
 * with conditional puts).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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

interface PersistentRegistryEntry<TSummary> {
  ownerAuthorId: string;
  currentVersion: string | null;
  versions: VersionEntry[];
  summary: TSummary | null;
}

interface PersistentRegistry {
  version: 1;
  packageVersion: string;
  generatedAt: string;
  commands: Record<string, PersistentRegistryEntry<CommandSummary>>;
  skills: Record<string, PersistentRegistryEntry<SkillSummary>>;
  workflows: Record<string, PersistentRegistryEntry<WorkflowSummary>>;
}

interface StoredArtifact<T> {
  artifact: T;
  metadata: VersionEntry;
}

export class FilesystemPersistentCatalogStorage implements CatalogStorage {
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    private readonly packageVersion: string = "0.0.0",
  ) {}

  /* ── Read ────────────────────────────────────────────────────── */

  async getIndex(): Promise<CatalogIndex> {
    const reg = this.readRegistry();
    const collect = <T>(
      entries: Record<string, PersistentRegistryEntry<T>>,
    ): T[] =>
      Object.values(entries)
        .filter((e) => e.currentVersion !== null && e.summary !== null)
        .map((e) => e.summary as T);
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      packageVersion: this.packageVersion,
      commands: collect(reg.commands),
      skills: collect(reg.skills),
      workflows: collect(reg.workflows),
    };
  }

  async getCommand(slug: string): Promise<Command | null> {
    const reg = this.readRegistry();
    const entry = reg.commands[slug];
    if (!entry || !entry.currentVersion) return null;
    return this.readArtifact<Command>("commands", slug, entry.currentVersion);
  }
  async getSkill(name: string): Promise<Skill | null> {
    const reg = this.readRegistry();
    const entry = reg.skills[name];
    if (!entry || !entry.currentVersion) return null;
    return this.readArtifact<Skill>("skills", name, entry.currentVersion);
  }
  async getWorkflow(qualifiedName: string): Promise<Workflow | null> {
    const reg = this.readRegistry();
    const entry = reg.workflows[qualifiedName];
    if (!entry || !entry.currentVersion) return null;
    return this.readArtifact<Workflow>(
      "workflows",
      qualifiedName,
      entry.currentVersion,
    );
  }

  async getCommandVersion(
    slug: string,
    version: string,
  ): Promise<Command | null> {
    return this.readArtifact<Command>("commands", slug, version);
  }
  async getSkillVersion(name: string, version: string): Promise<Skill | null> {
    return this.readArtifact<Skill>("skills", name, version);
  }
  async getWorkflowVersion(
    qualifiedName: string,
    version: string,
  ): Promise<Workflow | null> {
    return this.readArtifact<Workflow>("workflows", qualifiedName, version);
  }

  async listCommandVersions(slug: string): Promise<VersionEntry[]> {
    const entry = this.readRegistry().commands[slug];
    return entry ? entry.versions.map((v) => ({ ...v })) : [];
  }
  async listSkillVersions(name: string): Promise<VersionEntry[]> {
    const entry = this.readRegistry().skills[name];
    return entry ? entry.versions.map((v) => ({ ...v })) : [];
  }
  async listWorkflowVersions(qualifiedName: string): Promise<VersionEntry[]> {
    const entry = this.readRegistry().workflows[qualifiedName];
    return entry ? entry.versions.map((v) => ({ ...v })) : [];
  }

  /* ── Write ───────────────────────────────────────────────────── */

  async putCommand(input: PutCommandInput): Promise<VersionEntry> {
    return this.serialize(async () => {
      const reg = this.readRegistry();
      const slug = input.command.slug;
      const metadata = this.appendVersion(
        reg.commands,
        slug,
        input.author,
        input.version,
        input.changelog,
      );
      this.writeArtifact("commands", slug, input.version, {
        artifact: input.command,
        metadata,
      });
      this.writeRegistry(reg);
      return metadata;
    });
  }

  async putSkill(input: PutSkillInput): Promise<VersionEntry> {
    return this.serialize(async () => {
      const reg = this.readRegistry();
      const name = input.skill.name;
      const metadata = this.appendVersion(
        reg.skills,
        name,
        input.author,
        input.version,
        input.changelog,
      );
      this.writeArtifact("skills", name, input.version, {
        artifact: input.skill,
        metadata,
      });
      this.writeRegistry(reg);
      return metadata;
    });
  }

  async putWorkflow(input: PutWorkflowInput): Promise<VersionEntry> {
    return this.serialize(async () => {
      const reg = this.readRegistry();
      const qn = input.workflow.qualifiedName;
      const metadata = this.appendVersion(
        reg.workflows,
        qn,
        input.author,
        input.version,
        input.changelog,
      );
      this.writeArtifact("workflows", qn, input.version, {
        artifact: input.workflow,
        metadata,
      });
      this.writeRegistry(reg);
      return metadata;
    });
  }

  async promoteCommand(slug: string, version: string): Promise<void> {
    return this.serialize(async () => {
      const reg = this.readRegistry();
      this.promoteIn(reg.commands, slug, version, async () => {
        const cmd = await this.readArtifact<Command>("commands", slug, version);
        return cmd ? toCommandSummary(cmd) : null;
      });
      // promoteIn populates the summary via callback; await + write
      const entry = reg.commands[slug];
      if (entry) {
        const cmd = await this.readArtifact<Command>("commands", slug, version);
        entry.summary = cmd ? toCommandSummary(cmd) : null;
      }
      this.writeRegistry(reg);
    });
  }

  async promoteSkill(name: string, version: string): Promise<void> {
    return this.serialize(async () => {
      const reg = this.readRegistry();
      this.promoteIn(reg.skills, name, version, async () => null);
      const entry = reg.skills[name];
      if (entry) {
        const skill = await this.readArtifact<Skill>("skills", name, version);
        entry.summary = skill ? toSkillSummary(skill) : null;
      }
      this.writeRegistry(reg);
    });
  }

  async promoteWorkflow(
    qualifiedName: string,
    version: string,
  ): Promise<void> {
    return this.serialize(async () => {
      const reg = this.readRegistry();
      this.promoteIn(reg.workflows, qualifiedName, version, async () => null);
      const entry = reg.workflows[qualifiedName];
      if (entry) {
        const wf = await this.readArtifact<Workflow>(
          "workflows",
          qualifiedName,
          version,
        );
        entry.summary = wf ? toWorkflowSummary(wf) : null;
      }
      this.writeRegistry(reg);
    });
  }

  /* ── Internal: registry I/O ─────────────────────────────────── */

  private readRegistry(): PersistentRegistry {
    const path = join(this.root, "registry.json");
    if (!existsSync(path)) {
      return this.emptyRegistry();
    }
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as PersistentRegistry;
      // Defensive: ensure all kind buckets exist (forward-compat with
      // older registries that may have been written before a kind was
      // added).
      parsed.commands ??= {};
      parsed.skills ??= {};
      parsed.workflows ??= {};
      return parsed;
    } catch (err) {
      throw new Error(
        `Could not parse ${path}: ${(err as Error).message}. ` +
          `If the file is corrupt, restore from backup or remove to start fresh.`,
      );
    }
  }

  private writeRegistry(reg: PersistentRegistry): void {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
    reg.generatedAt = new Date().toISOString();
    atomicWriteJson(join(this.root, "registry.json"), reg);
  }

  private emptyRegistry(): PersistentRegistry {
    return {
      version: 1,
      packageVersion: this.packageVersion,
      generatedAt: new Date().toISOString(),
      commands: {},
      skills: {},
      workflows: {},
    };
  }

  /* ── Internal: artifact I/O ─────────────────────────────────── */

  private readArtifact<T>(
    kind: "commands" | "skills" | "workflows",
    key: string,
    version: string,
  ): T | null {
    const path = this.artifactPath(kind, key, version);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as StoredArtifact<T>;
      return parsed.artifact;
    } catch (err) {
      throw new Error(
        `Could not read artifact at ${path}: ${(err as Error).message}`,
      );
    }
  }

  private writeArtifact<T>(
    kind: "commands" | "skills" | "workflows",
    key: string,
    version: string,
    payload: StoredArtifact<T>,
  ): void {
    const dir = join(this.root, kind);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    atomicWriteJson(this.artifactPath(kind, key, version), payload);
  }

  private artifactPath(
    kind: "commands" | "skills" | "workflows",
    key: string,
    version: string,
  ): string {
    const filename = `${encodeKey(key)}@${version}.json`;
    return join(this.root, kind, filename);
  }

  /* ── Internal: shared put logic ─────────────────────────────── */

  /**
   * Append a new version to an existing entry (or create the entry
   * fresh). Enforces author-match-on-update and version uniqueness.
   * Caller must persist the registry afterward.
   */
  private appendVersion<T>(
    bucket: Record<string, PersistentRegistryEntry<T>>,
    key: string,
    author: AuthorIdentity,
    version: string,
    changelog: string | undefined,
  ): VersionEntry {
    const existing = bucket[key];
    if (existing) {
      if (existing.ownerAuthorId !== author.id) {
        throw new AuthorMismatchError(key, author.id, existing.ownerAuthorId);
      }
      if (existing.versions.some((v) => v.version === version)) {
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
    if (!existing) {
      bucket[key] = {
        ownerAuthorId: author.id,
        currentVersion: null,
        versions: [metadata],
        summary: null,
      };
    } else {
      existing.versions.push(metadata);
    }
    return metadata;
  }

  /**
   * Toggle `promoted` flags on the chosen version + clear it on
   * everything else for that key. Sets the bucket entry's
   * `currentVersion` pointer. Caller must update `summary` separately
   * (since it requires reading the artifact file, which is async).
   */
  private promoteIn<T>(
    bucket: Record<string, PersistentRegistryEntry<T>>,
    key: string,
    version: string,
    _summaryLoader: () => Promise<T | null>,
  ): void {
    const entry = bucket[key];
    if (!entry) throw new VersionNotFoundError(key, version);
    const target = entry.versions.find((v) => v.version === version);
    if (!target) throw new VersionNotFoundError(key, version);
    for (const v of entry.versions) {
      v.promoted = v.version === version;
    }
    entry.currentVersion = version;
  }

  /* ── Internal: mutation queue ───────────────────────────────── */

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(() => fn());
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }
}

/* ── module-level helpers ─────────────────────────────────────── */

/**
 * Encode a slug for use in a filename. Replaces `:` with `__` so the
 * result is portable across filesystems that reject `:`.
 */
function encodeKey(key: string): string {
  return key.replace(/:/g, "__");
}

/**
 * Atomically write JSON to a path. Strategy: write to a temp file
 * adjacent to the target, then rename. Rename is atomic at the
 * syscall level, so a crash mid-write leaves either the old file or
 * the new file - never a half-written one.
 */
function atomicWriteJson(path: string, data: unknown): void {
  const tmpPath = `${path}.tmp.${process.pid}.${Date.now()}.${Math.floor(
    Math.random() * 1_000_000,
  )}`;
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
    });
    renameSync(tmpPath, path);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup; original error is what matters
    }
    throw err;
  }
}

/* ── exported for tests ──────────────────────────────────────── */

export { encodeKey };

/**
 * Best-effort listing of all artifact files under a given storage
 * root + kind. Intended for diagnostics and tests; not used by the
 * CatalogStorage interface itself (which routes via the registry).
 */
export function listArtifactFiles(
  root: string,
  kind: "commands" | "skills" | "workflows",
): string[] {
  const dir = join(root, kind);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}
