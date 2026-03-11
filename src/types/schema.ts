import { z } from "zod";

// ── Config Schemas ──────────────────────────────────────────────────────────

export const MemberSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  aliases: z.array(z.string()).optional().default([]),
  /** GitHub username (without @) for PR/review metrics. */
  githubHandle: z.string().optional(),
});

export const TeamSchema = z.object({
  name: z.string(),
  tag: z.string().optional().default("default"),
  members: z.array(MemberSchema),
});

export const OrgSchema = z.object({
  name: z.string(),
  type: z.enum(["core", "consultant"]),
  /** Prefix pattern to auto-match authors by identifier in git name, e.g. "ACN" matches "(ACNxxx)". */
  identifier: z.string().optional(),
  teams: z.array(TeamSchema),
});

export const RepoSchema = z.object({
  path: z.string(),
  name: z.string().optional(),
  group: z.string().optional().default("default"),
});

export const ConfigSchema = z.object({
  workspace: z.string().optional(),
  repos: z.array(RepoSchema).optional().default([]),
  orgs: z.array(OrgSchema).optional().default([]),
  groups: z
    .record(z.string(), z.object({ label: z.string().optional() }))
    .optional()
    .default({}),
  tags: z
    .record(z.string(), z.object({ label: z.string().optional() }))
    .optional()
    .default({}),
  /** Custom file classification rules. Patterns are matched before built-in rules (first match wins).
   *  Each rule maps a glob pattern to a filetype category.
   *  Example: { "*.tf": "config", "*.proto": "app", "src/generated/**": "config" }
   */
  classification: z
    .record(z.string(), z.enum(["app", "test", "config", "storybook", "doc"]))
    .optional(),
  settings: z
    .object({
      weeks_back: z.number().optional().default(12),
      staleness_minutes: z.number().optional().default(60),
      trend_threshold: z.number().optional().default(0.10),
      /** Glob patterns for files to exclude from metrics (e.g. "package-lock.json", "*.min.js", "dist/*"). */
      ignore_patterns: z.array(z.string()).optional(),
    })
    .optional()
    .default({ weeks_back: 12, staleness_minutes: 60, trend_threshold: 0.10 }),
});

// ── Data Schemas ────────────────────────────────────────────────────────────

const FiletypeMetricsSchema = z.object({
  files: z.number(),
  filesAdded: z.number().optional().default(0),
  filesDeleted: z.number().optional().default(0),
  insertions: z.number(),
  deletions: z.number(),
});

export const UserWeekRepoRecordSchema = z.object({
  // Identity
  member: z.string(),
  email: z.string(),
  org: z.string(),
  orgType: z.enum(["core", "consultant"]),
  team: z.string(),
  tag: z.string(),

  // Dimensions
  week: z.string(),
  repo: z.string(),
  group: z.string(),

  // Metrics
  commits: z.number(),
  activeDays: z.number(),

  // Semantic intent breakdown (from conventional commit prefixes).
  // Optional for backwards compatibility with records created before this field existed.
  intent: z.object({
    feat: z.number().optional().default(0),
    fix: z.number().optional().default(0),
    refactor: z.number().optional().default(0),
    docs: z.number().optional().default(0),
    test: z.number().optional().default(0),
    chore: z.number().optional().default(0),
    other: z.number().optional().default(0),
  }).optional(),

  // File type breakdown
  filetype: z.object({
    app: FiletypeMetricsSchema,
    test: FiletypeMetricsSchema,
    config: FiletypeMetricsSchema,
    storybook: FiletypeMetricsSchema,
    doc: FiletypeMetricsSchema.optional().default({
      files: 0,
      filesAdded: 0,
      filesDeleted: 0,
      insertions: 0,
      deletions: 0,
    }),
  }),
});

export const CommitsByFiletypeSchema = z.object({
  version: z.literal(1),
  lastUpdated: z.string(),
  records: z.array(UserWeekRepoRecordSchema),
});

const RepoScanStateSchema = z.object({
  lastHash: z.string(),
  lastScanDate: z.string(),
  recentHashes: z.array(z.string()),
  recordCount: z.number(),
});

export const ScanStateSchema = z.object({
  version: z.literal(1),
  repos: z.record(z.string(), RepoScanStateSchema),
});

// ── Author Registry Schemas ────────────────────────────────────────────────

export const DiscoveredAuthorSchema = z.object({
  email: z.string(),
  name: z.string(),
  /** Extracted from parenthesized identifier in git name, e.g. "CONEWC" from "Edwin Cruz (CONEWC)". */
  identifier: z.string().optional(),
  /** GitHub username (without @) for PR/review metrics. */
  githubHandle: z.string().optional(),
  /** Assigned org name (undefined = unassigned). */
  org: z.string().optional(),
  /** Assigned team name (undefined = unassigned). */
  team: z.string().optional(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  reposSeenIn: z.array(z.string()),
  commitCount: z.number(),
});

export const AuthorRegistrySchema = z.object({
  version: z.literal(1),
  authors: z.record(z.string(), DiscoveredAuthorSchema),
});

// ── Enrichment Schemas ────────────────────────────────────────────────────

export const ProductivityExtensionsSchema = z.object({
  prs_opened: z.number().default(0),
  prs_merged: z.number().default(0),
  avg_cycle_hrs: z.number().default(0),
  reviews_given: z.number().default(0),
  churn_rate_pct: z.number().default(0),
  /** PR branch type counts — parsed from enforced branch naming conventions. */
  pr_feature: z.number().default(0),
  pr_fix: z.number().default(0),
  pr_bugfix: z.number().default(0),
  pr_chore: z.number().default(0),
  pr_hotfix: z.number().default(0),
  pr_other: z.number().default(0),
});

export const EnrichmentStoreSchema = z.object({
  version: z.literal(1),
  lastUpdated: z.string(),
  enrichments: z.record(z.string(), ProductivityExtensionsSchema),
  // key format: "member::week::repo" (same as commits store)
});

// ── Repos Registry Schemas ─────────────────────────────────────────────────

export const WorkspaceRepoSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  group: z.string().optional().default("default"),
  tags: z.array(z.string()).optional().default([]),
});

export const WorkspaceSchema = z.object({
  label: z.string().optional(),
  repos: z.array(WorkspaceRepoSchema),
});

export const ReposRegistrySchema = z.object({
  workspaces: z.record(z.string(), WorkspaceSchema),
  groups: z
    .record(z.string(), z.object({ label: z.string().optional() }))
    .optional()
    .default({}),
  tags: z
    .record(z.string(), z.object({ label: z.string().optional() }))
    .optional()
    .default({}),
});

// ── Inferred Types ──────────────────────────────────────────────────────────

export type Member = z.infer<typeof MemberSchema>;
export type Team = z.infer<typeof TeamSchema>;
export type Org = z.infer<typeof OrgSchema>;
export type Repo = z.infer<typeof RepoSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export type FiletypeMetrics = z.infer<typeof FiletypeMetricsSchema>;
export type UserWeekRepoRecord = z.infer<typeof UserWeekRepoRecordSchema>;
export type CommitsByFiletype = z.infer<typeof CommitsByFiletypeSchema>;
export type ScanState = z.infer<typeof ScanStateSchema>;

export type DiscoveredAuthor = z.infer<typeof DiscoveredAuthorSchema>;
export type AuthorRegistry = z.infer<typeof AuthorRegistrySchema>;

export type ProductivityExtensions = z.infer<typeof ProductivityExtensionsSchema>;
export type EnrichmentStore = z.infer<typeof EnrichmentStoreSchema>;

export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type ReposRegistry = z.infer<typeof ReposRegistrySchema>;
