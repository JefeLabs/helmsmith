/**
 * Layer 1: structural validation. Sync, deterministic, ms-latency.
 *
 * Checks the contribution's identity (slug/name format), declares
 * what frontmatter fields each kind requires, validates tags against
 * the format rules + TAGS.md core list, and resolves slash-command
 * references in the body against the current catalog. Findings are
 * accumulated rather than thrown — callers can decide which severity
 * levels block.
 *
 * Layer 2 (bundle/file safety) and layer 3 (agent review) live in
 * separate modules; this layer is the cheapest and runs first.
 */

import type {
  CatalogIndex,
  ContributionKind,
  CreateContributionRequest,
  ReviewFinding,
} from "../contracts.js";

/** Slash-command slug regex: lowercase, segment-separated by colons,
 *  each segment starts with a letter and may contain digits/hyphens.
 *  Example matches: `core:tools:biome`, `product:strategy:scaffold`. */
const COMMAND_SLUG_REGEX = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)+$/;

/** Skill name regex: single segment, lowercase, hyphens allowed.
 *  Example: `skillzkit-product-router`. */
const SKILL_NAME_REGEX = /^[a-z][a-z0-9-]*$/;

/** Tag format regex: same as the doctor's check. */
const TAG_REGEX = /^[a-z][a-z0-9-]{0,23}$/;

/** Reference regex matching `/foo:bar:baz` patterns in artifact bodies.
 *  Same one used by lib/load.ts at catalog-build time. */
const REFERENCE_REGEX = /\/([a-z][a-z0-9_-]*(?::[a-z0-9_*-]+)+)/gi;

/** Hard cap on body length per file. Protects layer-3 token budget
 *  (when enabled) and signals that artifacts longer than this are
 *  probably trying to inline content that should be referenced. */
const MAX_BODY_LENGTH = 50_000;

export interface StructuralValidationOptions {
  /** Current catalog index — used to resolve `/slug` references in the
   *  body and to surface "this slug already exists; you'll be
   *  publishing as the slug owner" hints. Optional: pass null to skip
   *  cross-catalog checks (useful for unit tests). */
  catalog: CatalogIndex | null;
  /** Core tag whitelist from TAGS.md. Tags in this set are reported
   *  silently; anything else is reported as low-severity (extension)
   *  for visibility. Pass empty Set to skip the check. */
  coreTags: Set<string>;
}

export function validateStructural(
  req: CreateContributionRequest,
  options: StructuralValidationOptions,
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  validateSlug(req.kind, req.slug, findings);
  validateRequiredFrontmatter(req.kind, req.frontmatter, findings);
  validateTags(req.frontmatter, options.coreTags, findings);
  validateReferences(req, options.catalog, findings);
  validateBodyLength(req.files, findings);

  return findings;
}

/* ── slug / name format ──────────────────────────────────────── */

function validateSlug(
  kind: ContributionKind,
  slug: string,
  findings: ReviewFinding[],
): void {
  if (!slug || slug.length === 0) {
    findings.push({
      severity: "high",
      axis: "structural",
      message: `Missing slug/name`,
    });
    return;
  }

  if (kind === "skill") {
    if (!SKILL_NAME_REGEX.test(slug)) {
      findings.push({
        severity: "high",
        axis: "structural",
        message: `Skill name "${slug}" does not match \`[a-z][a-z0-9-]*\` — lowercase letters, digits, hyphens; must start with a letter`,
      });
    }
  } else if (!COMMAND_SLUG_REGEX.test(slug)) {
    findings.push({
      severity: "high",
      axis: "structural",
      message: `${kind} slug "${slug}" does not match \`<segment>(:<segment>)+\` — colon-separated lowercase segments (e.g., "product:strategy:scaffold")`,
    });
  }
}

/* ── required frontmatter per kind ───────────────────────────── */

interface RequiredField {
  key: string;
  predicate: (value: unknown) => boolean;
  hint: string;
}

function requiredFor(kind: ContributionKind): RequiredField[] {
  // Common to all kinds: a non-empty `description`. The kind-specific
  // additions reflect the existing catalog conventions (workflows
  // declare `outcome`, etc.) — see lib/types.ts and TAGS.md / the
  // skillzkit-author skill body for the source of truth.
  const common: RequiredField[] = [
    {
      key: "description",
      predicate: (v) => typeof v === "string" && v.trim().length > 0,
      hint: "non-empty string describing what this artifact does",
    },
  ];
  if (kind === "workflow") {
    return [
      ...common,
      {
        key: "outcome",
        predicate: (v) => typeof v === "string" && v.trim().length > 0,
        hint: 'imperative verb + outcome, e.g. "Apply a brand refresh"',
      },
    ];
  }
  if (kind === "skill") {
    return [
      ...common,
      {
        key: "name",
        predicate: (v) => typeof v === "string" && SKILL_NAME_REGEX.test(v),
        hint: "lowercase identifier matching the skill's directory name",
      },
    ];
  }
  return common;
}

function validateRequiredFrontmatter(
  kind: ContributionKind,
  fm: Record<string, unknown>,
  findings: ReviewFinding[],
): void {
  for (const field of requiredFor(kind)) {
    const value = fm[field.key];
    if (value === undefined || value === null) {
      findings.push({
        severity: "high",
        axis: "structural",
        message: `Missing frontmatter field \`${field.key}\` (${field.hint})`,
      });
    } else if (!field.predicate(value)) {
      findings.push({
        severity: "high",
        axis: "structural",
        message: `Frontmatter field \`${field.key}\` is invalid — expected ${field.hint}`,
      });
    }
  }
}

/* ── tags ────────────────────────────────────────────────────── */

function validateTags(
  fm: Record<string, unknown>,
  coreTags: Set<string>,
  findings: ReviewFinding[],
): void {
  const raw = fm.tags;
  if (raw === undefined || raw === null) return;

  let tags: string[];
  if (Array.isArray(raw) && raw.every((t) => typeof t === "string")) {
    tags = raw;
  } else if (typeof raw === "string") {
    // Comma-separated form, mirroring the loader's tolerance
    tags = raw.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    findings.push({
      severity: "high",
      axis: "structural",
      message: `Frontmatter \`tags\` must be an array of strings or a comma-separated string`,
    });
    return;
  }

  const seen = new Set<string>();
  for (const tag of tags) {
    if (seen.has(tag)) {
      findings.push({
        severity: "medium",
        axis: "structural",
        message: `Duplicate tag \`${tag}\``,
      });
      continue;
    }
    seen.add(tag);
    if (!TAG_REGEX.test(tag)) {
      findings.push({
        severity: "high",
        axis: "structural",
        message: `Tag \`${tag}\` violates format — must be lowercase, hyphen-separated, ASCII letters/digits only, max 24 chars`,
      });
      continue;
    }
    if (coreTags.size > 0 && !coreTags.has(tag)) {
      findings.push({
        severity: "low",
        axis: "structural",
        message: `Tag \`${tag}\` is an extension (not in TAGS.md core list) — fine, but flagged for vocabulary visibility`,
      });
    }
  }
}

/* ── references ──────────────────────────────────────────────── */

function validateReferences(
  req: CreateContributionRequest,
  catalog: CatalogIndex | null,
  findings: ReviewFinding[],
): void {
  if (!catalog) return;
  const knownSlugs = new Set<string>([
    ...catalog.commands.map((c) => c.slug),
    ...catalog.skills.map((s) => s.name),
    ...catalog.workflows.map((w) => w.qualifiedName),
  ]);

  for (const file of req.files) {
    if (!file.path.endsWith(".md")) continue;
    for (const match of file.content.matchAll(REFERENCE_REGEX)) {
      const ref = match[1].replace(/[.,;:)\]*]+$/, "");
      if (ref.includes("*")) continue; // wildcards aren't required to resolve
      if (ref === req.slug) continue; // self-references are intentional
      if (!knownSlugs.has(ref)) {
        findings.push({
          severity: "medium",
          axis: "structural",
          message: `Body cites \`/${ref}\` but no such slug exists in the current catalog`,
          fileRef: file.path,
        });
      }
    }
  }
}

/* ── body length ─────────────────────────────────────────────── */

function validateBodyLength(
  files: { path: string; content: string }[],
  findings: ReviewFinding[],
): void {
  for (const file of files) {
    if (!file.path.endsWith(".md")) continue;
    if (file.content.length > MAX_BODY_LENGTH) {
      findings.push({
        severity: "high",
        axis: "structural",
        message: `Body of \`${file.path}\` is ${file.content.length} bytes; max ${MAX_BODY_LENGTH}. Consider splitting into separate artifacts.`,
        fileRef: file.path,
      });
    }
  }
}
