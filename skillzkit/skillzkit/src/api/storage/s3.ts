/**
 * S3-backed CatalogStorage. The production storage backend for AWS
 * Lambda deploys (and any other serverless target sitting in front of
 * an S3 bucket). Mirrors the fs-persistent layout structurally, with
 * two concurrency adaptations that fs-persistent doesn't need:
 *
 *   1. ETag-based conditional writes on registry.json. Multiple
 *      Lambda invocations can race; CAS via `IfMatch` lets us detect
 *      concurrent mutations and retry the read-modify-write loop.
 *
 *   2. In-process Promise queue for redundancy. Within a single warm
 *      Lambda container, the queue serializes writes so we don't
 *      waste retries on intra-process collisions. The ETag check
 *      handles inter-process collisions.
 *
 * This module deliberately depends on a minimal `S3Like` interface,
 * NOT on `@aws-sdk/client-s3` directly. That decoupling lets:
 *   - Tests run with an in-memory S3-like fake.
 *   - The AWS SDK adapter (s3-aws-client.ts) be a separate file users
 *     install only when actually deploying to AWS.
 */

import type {
  AuthorIdentity,
  CatalogIndex,
  Command,
  CommandSummary,
  Skill,
  SkillSummary,
  VersionEntry,
  Workflow,
  WorkflowSummary,
} from '../contracts.js';
import { toCommandSummary, toSkillSummary, toWorkflowSummary } from '../contracts.js';
import {
  AuthorMismatchError,
  type CatalogStorage,
  type PutCommandInput,
  type PutSkillInput,
  type PutWorkflowInput,
  VersionConflictError,
  VersionNotFoundError,
} from './interface.js';

/* ── S3-like interface (avoids depending on the AWS SDK directly) ── */

export interface S3GetResult {
  body: string;
  etag?: string;
}

export interface S3PutResult {
  etag?: string;
}

export interface S3PutOptions {
  /** Conditional write: only succeed if the current object's ETag
   *  matches. Used for compare-and-swap semantics. */
  ifMatch?: string;
  /** Conditional write: only succeed if the object does NOT exist
   *  yet. Used to atomically initialize a key. */
  ifNoneMatch?: string;
}

/**
 * Class of error implementations should throw on a 412
 * PreconditionFailed (an `ifMatch` that didn't match, or an
 * `ifNoneMatch: "*"` against an existing object). The S3 backend
 * uses this to recognize CAS retry conditions cleanly.
 */
export class S3PreconditionFailedError extends Error {
  constructor(message = 'S3 precondition failed (ETag mismatch or object exists)') {
    super(message);
    this.name = 'S3PreconditionFailedError';
  }
}

/**
 * Class of error implementations should throw on a 404 NoSuchKey.
 * S3CatalogStorage uses this to handle missing-registry cases at
 * first init.
 */
export class S3NotFoundError extends Error {
  constructor(message = 'S3 object not found') {
    super(message);
    this.name = 'S3NotFoundError';
  }
}

export interface S3Like {
  /**
   * Get an object's body + ETag. Throws S3NotFoundError when the
   * object doesn't exist - never returns null. (This matches the
   * AWS SDK's behavior of throwing on 404.)
   */
  getObject(key: string): Promise<S3GetResult>;
  /**
   * Put an object. Returns the new ETag. Throws
   * S3PreconditionFailedError on conditional-write failures.
   */
  putObject(key: string, body: string, options?: S3PutOptions): Promise<S3PutResult>;
}

/* ── Registry types (parallel to fs-persistent) ───────────────── */

interface S3RegistryEntry<TSummary> {
  ownerAuthorId: string;
  currentVersion: string | null;
  versions: VersionEntry[];
  summary: TSummary | null;
}

interface S3Registry {
  version: 1;
  packageVersion: string;
  generatedAt: string;
  commands: Record<string, S3RegistryEntry<CommandSummary>>;
  skills: Record<string, S3RegistryEntry<SkillSummary>>;
  workflows: Record<string, S3RegistryEntry<WorkflowSummary>>;
}

interface StoredArtifact<T> {
  artifact: T;
  metadata: VersionEntry;
}

interface RegistryWithEtag {
  registry: S3Registry;
  etag: string | undefined;
}

/* ── Storage implementation ────────────────────────────────────── */

export interface S3CatalogStorageOptions {
  /**
   * Key prefix for all skillzkit objects in the bucket. Defaults to
   * "v1/". Useful for sharing one bucket across multiple environments
   * (e.g., "dev/v1/", "prod/v1/").
   */
  prefix?: string;
  /**
   * Reported in `getIndex().packageVersion`. Defaults to "0.0.0".
   */
  packageVersion?: string;
  /**
   * Max retries on ETag CAS failures during registry updates.
   * Defaults to 5; each retry sleeps 50 * 2^i ms with jitter.
   */
  maxRetries?: number;
}

export class S3CatalogStorage implements CatalogStorage {
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private readonly prefix: string;
  private readonly packageVersion: string;
  private readonly maxRetries: number;

  constructor(
    private readonly s3: S3Like,
    options: S3CatalogStorageOptions = {},
  ) {
    this.prefix = options.prefix ?? 'v1/';
    this.packageVersion = options.packageVersion ?? '0.0.0';
    this.maxRetries = options.maxRetries ?? 5;
  }

  /* ── Read ────────────────────────────────────────────────────── */

  async getIndex(): Promise<CatalogIndex> {
    const { registry } = await this.readRegistry();
    const collect = <T>(entries: Record<string, S3RegistryEntry<T>>): T[] =>
      Object.values(entries)
        .filter((e) => e.currentVersion !== null && e.summary !== null)
        .map((e) => e.summary as T);
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      packageVersion: this.packageVersion,
      commands: collect(registry.commands),
      skills: collect(registry.skills),
      workflows: collect(registry.workflows),
    };
  }

  async getCommand(slug: string): Promise<Command | null> {
    const { registry } = await this.readRegistry();
    const entry = registry.commands[slug];
    if (!entry?.currentVersion) return null;
    return this.readArtifact<Command>('commands', slug, entry.currentVersion);
  }
  async getSkill(name: string): Promise<Skill | null> {
    const { registry } = await this.readRegistry();
    const entry = registry.skills[name];
    if (!entry?.currentVersion) return null;
    return this.readArtifact<Skill>('skills', name, entry.currentVersion);
  }
  async getWorkflow(qualifiedName: string): Promise<Workflow | null> {
    const { registry } = await this.readRegistry();
    const entry = registry.workflows[qualifiedName];
    if (!entry?.currentVersion) return null;
    return this.readArtifact<Workflow>('workflows', qualifiedName, entry.currentVersion);
  }

  async getCommandVersion(slug: string, version: string): Promise<Command | null> {
    return this.readArtifact<Command>('commands', slug, version);
  }
  async getSkillVersion(name: string, version: string): Promise<Skill | null> {
    return this.readArtifact<Skill>('skills', name, version);
  }
  async getWorkflowVersion(qualifiedName: string, version: string): Promise<Workflow | null> {
    return this.readArtifact<Workflow>('workflows', qualifiedName, version);
  }

  async listCommandVersions(slug: string): Promise<VersionEntry[]> {
    const { registry } = await this.readRegistry();
    const entry = registry.commands[slug];
    return entry ? entry.versions.map((v) => ({ ...v })) : [];
  }
  async listSkillVersions(name: string): Promise<VersionEntry[]> {
    const { registry } = await this.readRegistry();
    const entry = registry.skills[name];
    return entry ? entry.versions.map((v) => ({ ...v })) : [];
  }
  async listWorkflowVersions(qualifiedName: string): Promise<VersionEntry[]> {
    const { registry } = await this.readRegistry();
    const entry = registry.workflows[qualifiedName];
    return entry ? entry.versions.map((v) => ({ ...v })) : [];
  }

  /* ── Write ───────────────────────────────────────────────────── */

  async putCommand(input: PutCommandInput): Promise<VersionEntry> {
    return this.serialize(() =>
      this.putWithRetry((reg) => {
        const slug = input.command.slug;
        const metadata = appendVersion(
          reg.commands,
          slug,
          input.author,
          input.version,
          input.changelog,
        );
        return {
          metadata,
          artifactKind: 'commands',
          artifactKey: slug,
          artifactVersion: input.version,
          artifactPayload: { artifact: input.command, metadata },
        };
      }),
    );
  }

  async putSkill(input: PutSkillInput): Promise<VersionEntry> {
    return this.serialize(() =>
      this.putWithRetry((reg) => {
        const name = input.skill.name;
        const metadata = appendVersion(
          reg.skills,
          name,
          input.author,
          input.version,
          input.changelog,
        );
        return {
          metadata,
          artifactKind: 'skills',
          artifactKey: name,
          artifactVersion: input.version,
          artifactPayload: { artifact: input.skill, metadata },
        };
      }),
    );
  }

  async putWorkflow(input: PutWorkflowInput): Promise<VersionEntry> {
    return this.serialize(() =>
      this.putWithRetry((reg) => {
        const qn = input.workflow.qualifiedName;
        const metadata = appendVersion(
          reg.workflows,
          qn,
          input.author,
          input.version,
          input.changelog,
        );
        return {
          metadata,
          artifactKind: 'workflows',
          artifactKey: qn,
          artifactVersion: input.version,
          artifactPayload: { artifact: input.workflow, metadata },
        };
      }),
    );
  }

  async promoteCommand(slug: string, version: string): Promise<void> {
    return this.serialize(() =>
      this.promoteWithRetry('commands', slug, version, async (reg) => {
        const entry = reg.commands[slug];
        if (!entry) return;
        const cmd = await this.readArtifact<Command>('commands', slug, version);
        entry.summary = cmd ? toCommandSummary(cmd) : null;
      }),
    );
  }

  async promoteSkill(name: string, version: string): Promise<void> {
    return this.serialize(() =>
      this.promoteWithRetry('skills', name, version, async (reg) => {
        const entry = reg.skills[name];
        if (!entry) return;
        const skill = await this.readArtifact<Skill>('skills', name, version);
        entry.summary = skill ? toSkillSummary(skill) : null;
      }),
    );
  }

  async promoteWorkflow(qualifiedName: string, version: string): Promise<void> {
    return this.serialize(() =>
      this.promoteWithRetry('workflows', qualifiedName, version, async (reg) => {
        const entry = reg.workflows[qualifiedName];
        if (!entry) return;
        const wf = await this.readArtifact<Workflow>('workflows', qualifiedName, version);
        entry.summary = wf ? toWorkflowSummary(wf) : null;
      }),
    );
  }

  /* ── Internal: registry ─────────────────────────────────────── */

  private async readRegistry(): Promise<RegistryWithEtag> {
    const key = `${this.prefix}registry.json`;
    try {
      const result = await this.s3.getObject(key);
      const parsed = JSON.parse(result.body) as S3Registry;
      // Defensive: ensure all kind buckets exist (forward-compat).
      parsed.commands ??= {};
      parsed.skills ??= {};
      parsed.workflows ??= {};
      return { registry: parsed, etag: result.etag };
    } catch (err) {
      if (err instanceof S3NotFoundError) {
        return { registry: this.emptyRegistry(), etag: undefined };
      }
      throw err;
    }
  }

  private async writeRegistry(
    registry: S3Registry,
    expectedEtag: string | undefined,
  ): Promise<S3PutResult> {
    registry.generatedAt = new Date().toISOString();
    const key = `${this.prefix}registry.json`;
    const body = `${JSON.stringify(registry, null, 2)}\n`;
    if (expectedEtag === undefined) {
      // First-time write: only succeed if the object doesn't exist
      // yet. Two concurrent first-writers will collide here; the
      // loser will get S3PreconditionFailedError and retry, picking
      // up the winner's registry on the next read.
      return await this.s3.putObject(key, body, { ifNoneMatch: '*' });
    }
    return await this.s3.putObject(key, body, { ifMatch: expectedEtag });
  }

  private emptyRegistry(): S3Registry {
    return {
      version: 1,
      packageVersion: this.packageVersion,
      generatedAt: new Date().toISOString(),
      commands: {},
      skills: {},
      workflows: {},
    };
  }

  /* ── Internal: artifact ─────────────────────────────────────── */

  private async readArtifact<T>(
    kind: 'commands' | 'skills' | 'workflows',
    key: string,
    version: string,
  ): Promise<T | null> {
    const objectKey = this.artifactKey(kind, key, version);
    try {
      const result = await this.s3.getObject(objectKey);
      const parsed = JSON.parse(result.body) as StoredArtifact<T>;
      return parsed.artifact;
    } catch (err) {
      if (err instanceof S3NotFoundError) return null;
      throw err;
    }
  }

  private async writeArtifact<T>(
    kind: 'commands' | 'skills' | 'workflows',
    key: string,
    version: string,
    payload: StoredArtifact<T>,
  ): Promise<void> {
    const objectKey = this.artifactKey(kind, key, version);
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    await this.s3.putObject(objectKey, body);
  }

  private artifactKey(
    kind: 'commands' | 'skills' | 'workflows',
    key: string,
    version: string,
  ): string {
    return `${this.prefix}${kind}/${encodeKey(key)}@${version}.json`;
  }

  /* ── Internal: retry loops ──────────────────────────────────── */

  private async putWithRetry(
    mutator: (reg: S3Registry) => PutMutationResult,
  ): Promise<VersionEntry> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const { registry, etag } = await this.readRegistry();
      const result = mutator(registry);
      try {
        // Write the artifact first - it's immutable and any orphan
        // it leaves behind on later registry-write failure is
        // harmless (cleanup is a doctor concern, not a correctness
        // one).
        await this.writeArtifact(
          result.artifactKind,
          result.artifactKey,
          result.artifactVersion,
          result.artifactPayload,
        );
        await this.writeRegistry(registry, etag);
        return result.metadata;
      } catch (err) {
        if (err instanceof S3PreconditionFailedError) {
          if (attempt < this.maxRetries) {
            await sleep(50 * 2 ** attempt + Math.floor(Math.random() * 50));
            continue;
          }
        }
        throw err;
      }
    }
    throw new Error('S3CatalogStorage: putWithRetry exhausted retries');
  }

  private async promoteWithRetry(
    kind: 'commands' | 'skills' | 'workflows',
    key: string,
    version: string,
    summaryUpdate: (reg: S3Registry) => Promise<void>,
  ): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const { registry, etag } = await this.readRegistry();
      const bucket = registry[kind];
      const entry = bucket[key];
      if (!entry) throw new VersionNotFoundError(key, version);
      const target = entry.versions.find((v) => v.version === version);
      if (!target) throw new VersionNotFoundError(key, version);
      for (const v of entry.versions) {
        v.promoted = v.version === version;
      }
      entry.currentVersion = version;
      await summaryUpdate(registry);
      try {
        await this.writeRegistry(registry, etag);
        return;
      } catch (err) {
        if (err instanceof S3PreconditionFailedError) {
          if (attempt < this.maxRetries) {
            await sleep(50 * 2 ** attempt + Math.floor(Math.random() * 50));
            continue;
          }
        }
        throw err;
      }
    }
    throw new Error('S3CatalogStorage: promoteWithRetry exhausted retries');
  }

  /* ── Internal: queue ────────────────────────────────────────── */

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(() => fn());
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }
}

/* ── module-level helpers ─────────────────────────────────────── */

interface PutMutationResult {
  metadata: VersionEntry;
  artifactKind: 'commands' | 'skills' | 'workflows';
  artifactKey: string;
  artifactVersion: string;
  artifactPayload: StoredArtifact<unknown>;
}

function encodeKey(key: string): string {
  return key.replace(/:/g, '__');
}

function appendVersion<T>(
  bucket: Record<string, S3RegistryEntry<T>>,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { encodeKey };
