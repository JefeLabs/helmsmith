/**
 * Filesystem-backed CatalogStorage — read-only, points at the
 * existing skillzkit repo (catalog.json + .claude/ tree).
 *
 * Used by `skillzkit serve` for local development of the API: a
 * developer can run the API server against their working repo without
 * spinning up S3 or LocalStack. The repo is the source of truth, so
 * write operations throw — contribution flows in fs mode would
 * conflict with the file-based authoring workflow (you commit changes
 * via git, not via the API).
 *
 * Versioning in fs mode is degenerate: there's exactly one version
 * (the current state of the repo), reported as the catalog's
 * `packageVersion`. listVersions returns a single entry with
 * promoted=true; getCommandVersion accepts that one version or null.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Catalog } from '../../types.js';
import type {
  AuthorIdentity,
  CatalogIndex,
  Command,
  Skill,
  VersionEntry,
  Workflow,
} from '../contracts.js';
import { toCommandSummary, toSkillSummary, toWorkflowSummary } from '../contracts.js';
import type {
  CatalogStorage,
  PutCommandInput,
  PutSkillInput,
  PutWorkflowInput,
} from './interface.js';

/**
 * Synthetic author for the fs-backed read-only path. The fs catalog
 * has no per-artifact author tracking (the markdown files don't
 * carry it), so we surface a single placeholder identity. Callers
 * should treat this as "not from a real author identity" — fs-mode
 * isn't where contribution attribution lives.
 */
const FS_AUTHOR: AuthorIdentity = {
  id: 'fs:repo',
  displayName: 'skillzkit repo',
};

export class FilesystemCatalogStorage implements CatalogStorage {
  private cached: Catalog | undefined;

  constructor(private readonly packageRoot: string) {}

  /* ── Read ────────────────────────────────────────────────────── */

  async getIndex(): Promise<CatalogIndex> {
    const catalog = this.load();
    return {
      version: 1,
      generatedAt: catalog.generatedAt,
      packageVersion: catalog.packageVersion,
      commands: catalog.commands.map(toCommandSummary),
      skills: catalog.skills.map(toSkillSummary),
      workflows: catalog.workflows.map(toWorkflowSummary),
    };
  }

  async getCommand(slug: string): Promise<Command | null> {
    return this.load().commands.find((c) => c.slug === slug) ?? null;
  }
  async getSkill(name: string): Promise<Skill | null> {
    return this.load().skills.find((s) => s.name === name) ?? null;
  }
  async getWorkflow(qualifiedName: string): Promise<Workflow | null> {
    return this.load().workflows.find((w) => w.qualifiedName === qualifiedName) ?? null;
  }

  async getCommandVersion(slug: string, version: string): Promise<Command | null> {
    return this.matchesPackageVersion(version) ? this.getCommand(slug) : null;
  }
  async getSkillVersion(name: string, version: string): Promise<Skill | null> {
    return this.matchesPackageVersion(version) ? this.getSkill(name) : null;
  }
  async getWorkflowVersion(qualifiedName: string, version: string): Promise<Workflow | null> {
    return this.matchesPackageVersion(version) ? this.getWorkflow(qualifiedName) : null;
  }

  async listCommandVersions(slug: string): Promise<VersionEntry[]> {
    const cmd = await this.getCommand(slug);
    return cmd ? [this.singletonVersionEntry()] : [];
  }
  async listSkillVersions(name: string): Promise<VersionEntry[]> {
    const skill = await this.getSkill(name);
    return skill ? [this.singletonVersionEntry()] : [];
  }
  async listWorkflowVersions(qualifiedName: string): Promise<VersionEntry[]> {
    const wf = await this.getWorkflow(qualifiedName);
    return wf ? [this.singletonVersionEntry()] : [];
  }

  /* ── Write — refused in fs mode ──────────────────────────────── */

  async putCommand(_input: PutCommandInput): Promise<VersionEntry> {
    throw fsReadOnly('putCommand');
  }
  async putSkill(_input: PutSkillInput): Promise<VersionEntry> {
    throw fsReadOnly('putSkill');
  }
  async putWorkflow(_input: PutWorkflowInput): Promise<VersionEntry> {
    throw fsReadOnly('putWorkflow');
  }

  async promoteCommand(_slug: string, _version: string): Promise<void> {
    throw fsReadOnly('promoteCommand');
  }
  async promoteSkill(_name: string, _version: string): Promise<void> {
    throw fsReadOnly('promoteSkill');
  }
  async promoteWorkflow(_qualifiedName: string, _version: string): Promise<void> {
    throw fsReadOnly('promoteWorkflow');
  }

  /* ── Internal ───────────────────────────────────────────────── */

  /**
   * Lazily load + cache the catalog. The fs-backed API is read-only
   * within a process lifetime, so caching once is correct; if the
   * underlying catalog.json regenerates while the server is running,
   * a server restart picks it up. Live reload would add complexity
   * not warranted for local dev.
   */
  private load(): Catalog {
    if (this.cached) return this.cached;
    const catalogPath = join(this.packageRoot, 'catalog.json');
    if (!existsSync(catalogPath)) {
      throw new Error(
        `catalog.json not found at ${catalogPath}. Run \`npm run catalog\` to generate it.`,
      );
    }
    this.cached = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog;
    return this.cached;
  }

  private matchesPackageVersion(version: string): boolean {
    return version === this.load().packageVersion;
  }

  private singletonVersionEntry(): VersionEntry {
    return {
      version: this.load().packageVersion,
      author: FS_AUTHOR,
      createdAt: this.load().generatedAt,
      promoted: true,
    };
  }
}

/**
 * Walk up from a starting directory to find the skillzkit package
 * root, defined as the first ancestor containing a catalog.json. Same
 * convention as the CLI's findPackageRoot — extracted here so the API
 * server's fs storage can use the same logic.
 */
export function findSkillzkitPackageRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'catalog.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `skillzkit package root not found searching upward from ${startDir} — catalog.json missing`,
  );
}

function fsReadOnly(op: string): Error {
  return new Error(
    `${op}: filesystem-backed storage is read-only. The repo is the source of truth — commit changes via git. Use the memory or s3 storage backends for write operations.`,
  );
}
