/**
 * Contribute orchestrator. Glues together:
 *   1. validateContribution() - layers 1+2 (and 3 if reviewer wired)
 *   2. deriveNextVersion() - semver bump from existing versions
 *   3. buildArtifact() - CreateContributionRequest into typed Command/Skill/Workflow
 *   4. storage.put*() - durable persistence + author-match-on-update enforcement
 *
 * The endpoint handler in server/app.ts is a thin wrapper around
 * `submitContribution()` from this module - separating policy from
 * transport so the same logic is testable without HTTP.
 */

import type {
  CatalogIndex,
  Command,
  ContributionFile,
  ContributionResponse,
  CreateContributionRequest,
  ReviewFinding,
  Skill,
  Workflow,
} from "./contracts.js";
import type { AuthorIdentity } from "./contracts.js";
import {
  AuthorMismatchError,
  type CatalogStorage,
  VersionConflictError,
} from "./storage/interface.js";
import {
  type ContributionReviewer,
  validateContribution,
} from "./validation.js";

export interface SubmitContributionOptions {
  storage: CatalogStorage;
  author: AuthorIdentity;
  reviewer?: ContributionReviewer;
  catalog: CatalogIndex | null;
  coreTags: Set<string>;
}

export type SubmitResult =
  | { kind: "validation_failed"; findings: ReviewFinding[] }
  | { kind: "author_mismatch"; slug: string; ownerAuthorId: string }
  | { kind: "version_conflict"; slug: string; version: string }
  | { kind: "accepted"; response: ContributionResponse };

export async function submitContribution(
  req: CreateContributionRequest,
  options: SubmitContributionOptions,
): Promise<SubmitResult> {
  const validation = await validateContribution(req, {
    catalog: options.catalog,
    coreTags: options.coreTags,
    reviewer: options.reviewer,
  });
  if (!validation.passed) {
    return { kind: "validation_failed", findings: validation.findings };
  }

  const existingVersions = await listExistingVersions(req, options.storage);
  const nextVersion = deriveNextVersion(
    existingVersions.map((v) => v.version),
    req.versionBump ?? "patch",
  );

  const artifact = buildArtifact(req);

  try {
    if (req.kind === "command") {
      await options.storage.putCommand({
        command: artifact.command!,
        version: nextVersion,
        author: options.author,
        changelog: req.changelog,
      });
    } else if (req.kind === "workflow") {
      await options.storage.putWorkflow({
        workflow: artifact.workflow!,
        version: nextVersion,
        author: options.author,
        changelog: req.changelog,
      });
    } else {
      await options.storage.putSkill({
        skill: artifact.skill!,
        version: nextVersion,
        author: options.author,
        changelog: req.changelog,
      });
    }
  } catch (err) {
    if (err instanceof AuthorMismatchError) {
      return {
        kind: "author_mismatch",
        slug: err.slug,
        ownerAuthorId: err.ownerAuthorId,
      };
    }
    if (err instanceof VersionConflictError) {
      return {
        kind: "version_conflict",
        slug: err.slug,
        version: err.version,
      };
    }
    throw err;
  }

  const response: ContributionResponse = {
    id: `${req.kind}:${req.slug}@${nextVersion}`,
    slug: req.slug,
    kind: req.kind,
    status: "accepted",
    version: nextVersion,
    promoted: false,
    author: options.author,
    findings: validation.findings,
    createdAt: new Date().toISOString(),
  };
  return { kind: "accepted", response };
}

export function deriveNextVersion(
  existing: string[],
  bump: "major" | "minor" | "patch" = "patch",
): string {
  if (existing.length === 0) return "1.0.0";

  const parsed = existing.map(parseSemver);
  if (parsed.some((v) => v === null)) {
    return integerIncrement(existing);
  }

  const sorted = (parsed as ParsedSemver[]).slice().sort(compareSemver);
  const top = sorted[sorted.length - 1];

  if (bump === "major") return `${top.major + 1}.0.0`;
  if (bump === "minor") return `${top.major}.${top.minor + 1}.0`;
  return `${top.major}.${top.minor}.${top.patch + 1}`;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(v: string): ParsedSemver | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return {
    major: Number.parseInt(m[1], 10),
    minor: Number.parseInt(m[2], 10),
    patch: Number.parseInt(m[3], 10),
  };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function integerIncrement(existing: string[]): string {
  const ints = existing
    .map((v) => Number.parseInt(v, 10))
    .filter((n) => !Number.isNaN(n));
  if (ints.length === 0) return "1";
  return String(Math.max(...ints) + 1);
}

interface BuiltArtifact {
  command?: Command;
  skill?: Skill;
  workflow?: Workflow;
}

function buildArtifact(req: CreateContributionRequest): BuiltArtifact {
  if (req.kind === "command") {
    const file = req.files[0];
    return {
      command: {
        slug: req.slug,
        path: file.path,
        kind: "command",
        description: stringFm(req.frontmatter, "description") ?? "",
        outcome: stringFm(req.frontmatter, "outcome"),
        argumentHint: stringFm(req.frontmatter, "argument-hint"),
        allowedTools: stringArrayFm(req.frontmatter, "allowed-tools"),
        references: [],
        referencedBy: [],
        tags: stringArrayFm(req.frontmatter, "tags"),
        body: file.content,
        frontmatter: req.frontmatter,
      },
    };
  }

  if (req.kind === "workflow") {
    const file = req.files[0];
    const [domain, slug] = req.slug.split(":");
    return {
      workflow: {
        qualifiedName: req.slug,
        domain,
        slug,
        commandSlug: req.slug,
        description: stringFm(req.frontmatter, "description") ?? "",
        outcome: stringFm(req.frontmatter, "outcome"),
        estimatedDuration: stringFm(req.frontmatter, "estimatedDuration"),
        prerequisites: stringArrayFm(req.frontmatter, "prerequisites"),
        references: [],
        tags: stringArrayFm(req.frontmatter, "tags"),
        body: file.content,
        frontmatter: req.frontmatter,
      },
    };
  }

  const skillFile = req.files.find((f) => f.path === "SKILL.md");
  if (!skillFile) {
    throw new Error("Internal: skill bundle missing SKILL.md after validation");
  }
  return {
    skill: {
      name: req.slug,
      path: `${req.slug}/SKILL.md`,
      description: stringFm(req.frontmatter, "description") ?? "",
      references: [],
      tags: stringArrayFm(req.frontmatter, "tags"),
      body: skillFile.content,
      frontmatter: req.frontmatter,
    },
  };
}

function stringFm(
  fm: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = fm[key];
  return typeof v === "string" ? v : undefined;
}

function stringArrayFm(
  fm: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const v = fm[key];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

async function listExistingVersions(
  req: CreateContributionRequest,
  storage: CatalogStorage,
) {
  if (req.kind === "command") {
    return await storage.listCommandVersions(req.slug);
  }
  if (req.kind === "workflow") {
    return await storage.listWorkflowVersions(req.slug);
  }
  return await storage.listSkillVersions(req.slug);
}

export type { ContributionFile };
