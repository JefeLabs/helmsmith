import { z } from 'zod';

/** Metric keys the scorecard can compute; `settings.scorecard_weights` may only reference these. */
export const SCORECARD_METRIC_KEYS = [
  'commitsPerWeek',
  'daysPerWeek',
  'prsPerWeek',
  'prSizeP50',
  'prSizeP75',
  'cycleHrs',
  'reworkPct',
  'fixToFeat',
  'testPct',
  'breaking',
  'reviews',
  'reviewsPerPr',
  'repos',
  'scopes',
] as const;
export type ScorecardMetricKey = (typeof SCORECARD_METRIC_KEYS)[number];

const DEFAULT_BOT_PATTERNS = ['[bot]', 'dependabot', 'renovate', 'github-actions'];

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
  tag: z.string().optional().default('default'),
  members: z.array(MemberSchema),
});

export const OrgSchema = z.object({
  name: z.string(),
  type: z.enum(['core', 'consultant']),
  /** Prefix pattern to auto-match authors by identifier in git name, e.g. "ACN" matches "(ACNxxx)". */
  identifier: z.string().optional(),
  teams: z.array(TeamSchema),
});

export const RepoSchema = z.object({
  path: z.string(),
  name: z.string().optional(),
  group: z.string().optional().default('default'),
});

/** Settings sub-schema, factored out of `ConfigSchema` so `DEFAULT_SETTINGS` below can be
 *  typed from it directly (`Config['settings']` would circularly depend on this schema,
 *  since `Config = z.infer<typeof ConfigSchema>` and `ConfigSchema` embeds this schema). */
const SettingsSchema = z.object({
  weeks_back: z.number().optional().default(12),
  staleness_minutes: z.number().optional().default(60),
  trend_threshold: z.number().optional().default(0.1),
  /** Glob patterns for files to exclude from metrics (e.g. "package-lock.json", "*.min.js", "dist/*"). */
  ignore_patterns: z.array(z.string()).optional(),
  /** When true, `ignore_patterns` replaces the built-in defaults instead of extending them. */
  ignore_patterns_replace_defaults: z.boolean().optional().default(false),
  /** Blame window for the rework pass: a deleted line counts as rework only when it
   *  was written within this many days of the deleting commit. Default: 21 days. */
  churn_window_days: z.number().optional().default(21),
  /** Maximum concurrent git processes for the rework pass. Default: 3. */
  churn_concurrency: z.number().optional().default(3),
  /** Percentage of contributors classified as "high" segment. Default: 20. */
  segment_high_pct: z.number().min(1).max(50).optional().default(20),
  /** Percentage of contributors classified as "low" segment. Default: 20. */
  segment_low_pct: z.number().min(1).max(50).optional().default(20),
  /** Automatically prune records older than this many weeks after each scan.
   *  Set to 0 to disable auto-pruning. Default: 0 (disabled). */
  auto_prune_weeks: z.number().min(0).optional().default(0),
  /** Run the blame-based rework pass after each scan. Default: true. */
  rework_enabled: z.boolean().optional().default(true),
  /** Minimum cohort size before the scorecard shows percentiles. Default: 8. */
  scorecard_min_n: z.number().int().min(1).optional().default(8),
  /** Opt-in composite: metricKey → positive weight. Absent = no score column. */
  scorecard_weights: z
    .record(z.string(), z.number().positive())
    .optional()
    .refine(
      (w) =>
        !w || Object.keys(w).every((k) => (SCORECARD_METRIC_KEYS as readonly string[]).includes(k)),
      { message: `scorecard_weights keys must be one of: ${SCORECARD_METRIC_KEYS.join(', ')}` },
    ),
  /** Case-insensitive substrings identifying bot authors (name or email). */
  bot_patterns: z.array(z.string()).optional().default(DEFAULT_BOT_PATTERNS),
  /** Minimum cohort size before high/low segment labels are assigned. Default: 8. */
  segment_min_n: z.number().int().min(1).optional().default(8),
});

/** Default settings — use when constructing Config objects outside of Zod parsing.
 *  Also the single source for `ConfigSchema`'s `settings` default (see below). */
export const DEFAULT_SETTINGS: z.infer<typeof SettingsSchema> = {
  weeks_back: 12,
  staleness_minutes: 60,
  trend_threshold: 0.1,
  churn_window_days: 21,
  churn_concurrency: 3,
  segment_high_pct: 20,
  segment_low_pct: 20,
  auto_prune_weeks: 0,
  ignore_patterns_replace_defaults: false,
  rework_enabled: true,
  scorecard_min_n: 8,
  bot_patterns: DEFAULT_BOT_PATTERNS,
  segment_min_n: 8,
};

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
    .record(z.string(), z.enum(['app', 'test', 'config', 'storybook', 'doc']))
    .optional(),
  settings: SettingsSchema.optional().default(DEFAULT_SETTINGS),
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
  orgType: z.enum(['core', 'consultant']),
  team: z.string(),
  tag: z.string(),

  // Dimensions
  week: z.string(),
  repo: z.string(),
  group: z.string(),

  // Metrics
  commits: z.number(),
  activeDays: z.number(),
  /** Bitmask of weekdays with at least one commit (bit0 = Monday … bit6 = Sunday).
   *  Lets rollups union days across repos instead of summing counts. Optional for
   *  records created before this field existed (those fall back to activeDays). */
  activeDayMask: z.number().int().min(0).max(127).optional(),
  /** Merged PRs detected by the git-only first-parent proxy (see collector/pr-proxy.ts). */
  prsMergedGit: z.number().int().min(0).optional(),
  /** Size (ins+del, ignore-filtered) of each proxy-detected PR merged in this week. */
  prSizes: z.array(z.number().int().min(0)).optional(),
  /** Lines this member wrote within churn_window_days that were deleted this week (by anyone). */
  reworkLines: z.number().int().min(0).optional(),
  /** Subset of reworkLines deleted by the member themselves. */
  reworkSelfLines: z.number().int().min(0).optional(),

  // Semantic intent breakdown (from conventional commit prefixes).
  // Optional for backwards compatibility with records created before this field existed.
  intent: z
    .object({
      feat: z.number().optional().default(0),
      fix: z.number().optional().default(0),
      refactor: z.number().optional().default(0),
      docs: z.number().optional().default(0),
      test: z.number().optional().default(0),
      chore: z.number().optional().default(0),
      other: z.number().optional().default(0),
    })
    .optional(),

  // Semantic scope and breaking change tracking (from conventional commit parsing).
  // breakingChanges: count of commits with "!" breaking marker (e.g. "feat!:", "fix(auth)!:")
  breakingChanges: z.number().optional(),
  // scopes: unique conventional commit scopes seen in this record (e.g. ["auth", "api"])
  scopes: z.array(z.string()).optional(),

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
  /** Dedup cursor for the first-parent PR proxy pass (separate from recentHashes). */
  recentPrHashes: z.array(z.string()).optional(),
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
  /** Median hours from PR open to merge (calculateCycleTime takes the median, not the mean). */
  median_cycle_hrs: z.number().default(0),
  /** PRs this member reviewed that received any update in the window — not a count of reviews submitted. */
  prs_reviewed_touched: z.number().default(0),
  /** Retired: the blame-based rework metric supersedes it. Always 0; the column is kept for old rows. */
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
  group: z.string().optional().default('default'),
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
