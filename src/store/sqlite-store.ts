import Database from "better-sqlite3";
import { join } from "node:path";
import type {
  UserWeekRepoRecord,
  CommitsByFiletype,
  EnrichmentStore,
  ProductivityExtensions,
  ScanState,
  AuthorRegistry,
  DiscoveredAuthor,
} from "../types/schema.js";
import { getDataDir } from "./paths.js";

// ── Database path ───────────────────────────────────────────────────────────

export function getSQLitePath(): string {
  return join(getDataDir(), "gitradar.db");
}

// ── Database singleton ──────────────────────────────────────────────────────

let _db: Database.Database | null = null;

export function getDB(): Database.Database {
  if (!_db) {
    _db = new Database(getSQLitePath());
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    _db.pragma("busy_timeout = 5000");
    ensureSchema(_db);
  }
  return _db;
}

export function closeDB(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ── Schema ──────────────────────────────────────────────────────────────────

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      member TEXT NOT NULL,
      email TEXT NOT NULL,
      org TEXT NOT NULL,
      org_type TEXT NOT NULL,
      team TEXT NOT NULL,
      tag TEXT NOT NULL,
      week TEXT NOT NULL,
      repo TEXT NOT NULL,
      grp TEXT NOT NULL,
      commits INTEGER NOT NULL DEFAULT 0,
      active_days INTEGER NOT NULL DEFAULT 0,
      intent_feat INTEGER NOT NULL DEFAULT 0,
      intent_fix INTEGER NOT NULL DEFAULT 0,
      intent_refactor INTEGER NOT NULL DEFAULT 0,
      intent_docs INTEGER NOT NULL DEFAULT 0,
      intent_test INTEGER NOT NULL DEFAULT 0,
      intent_chore INTEGER NOT NULL DEFAULT 0,
      intent_other INTEGER NOT NULL DEFAULT 0,
      app_files INTEGER NOT NULL DEFAULT 0,
      app_files_added INTEGER NOT NULL DEFAULT 0,
      app_files_deleted INTEGER NOT NULL DEFAULT 0,
      app_ins INTEGER NOT NULL DEFAULT 0,
      app_del INTEGER NOT NULL DEFAULT 0,
      test_files INTEGER NOT NULL DEFAULT 0,
      test_files_added INTEGER NOT NULL DEFAULT 0,
      test_files_deleted INTEGER NOT NULL DEFAULT 0,
      test_ins INTEGER NOT NULL DEFAULT 0,
      test_del INTEGER NOT NULL DEFAULT 0,
      config_files INTEGER NOT NULL DEFAULT 0,
      config_files_added INTEGER NOT NULL DEFAULT 0,
      config_files_deleted INTEGER NOT NULL DEFAULT 0,
      config_ins INTEGER NOT NULL DEFAULT 0,
      config_del INTEGER NOT NULL DEFAULT 0,
      storybook_files INTEGER NOT NULL DEFAULT 0,
      storybook_files_added INTEGER NOT NULL DEFAULT 0,
      storybook_files_deleted INTEGER NOT NULL DEFAULT 0,
      storybook_ins INTEGER NOT NULL DEFAULT 0,
      storybook_del INTEGER NOT NULL DEFAULT 0,
      doc_files INTEGER NOT NULL DEFAULT 0,
      doc_files_added INTEGER NOT NULL DEFAULT 0,
      doc_files_deleted INTEGER NOT NULL DEFAULT 0,
      doc_ins INTEGER NOT NULL DEFAULT 0,
      doc_del INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (member, week, repo)
    );

    CREATE INDEX IF NOT EXISTS idx_records_week ON records(week);
    CREATE INDEX IF NOT EXISTS idx_records_repo ON records(repo);
    CREATE INDEX IF NOT EXISTS idx_records_org ON records(org);
    CREATE INDEX IF NOT EXISTS idx_records_team ON records(team);

    CREATE TABLE IF NOT EXISTS enrichments (
      key TEXT PRIMARY KEY,
      prs_opened INTEGER NOT NULL DEFAULT 0,
      prs_merged INTEGER NOT NULL DEFAULT 0,
      avg_cycle_hrs REAL NOT NULL DEFAULT 0,
      reviews_given INTEGER NOT NULL DEFAULT 0,
      churn_rate_pct REAL NOT NULL DEFAULT 0,
      pr_feature INTEGER NOT NULL DEFAULT 0,
      pr_fix INTEGER NOT NULL DEFAULT 0,
      pr_bugfix INTEGER NOT NULL DEFAULT 0,
      pr_chore INTEGER NOT NULL DEFAULT 0,
      pr_hotfix INTEGER NOT NULL DEFAULT 0,
      pr_other INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS scan_state (
      repo TEXT PRIMARY KEY,
      last_hash TEXT NOT NULL,
      last_scan_date TEXT NOT NULL,
      recent_hashes TEXT NOT NULL DEFAULT '[]',
      record_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS authors (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      identifier TEXT,
      github_handle TEXT,
      org TEXT,
      team TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      repos_seen_in TEXT NOT NULL DEFAULT '[]',
      commit_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrations for existing databases
  migrateEnrichmentBranchColumns(db);
}

/** Add pr_branch columns to enrichments if they don't exist (migration v2). */
function migrateEnrichmentBranchColumns(db: Database.Database): void {
  const columns = db.pragma("table_info(enrichments)") as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has("pr_feature")) {
    db.exec(`
      ALTER TABLE enrichments ADD COLUMN pr_feature INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichments ADD COLUMN pr_fix INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichments ADD COLUMN pr_bugfix INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichments ADD COLUMN pr_chore INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichments ADD COLUMN pr_hotfix INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE enrichments ADD COLUMN pr_other INTEGER NOT NULL DEFAULT 0;
    `);
  }
}

// ── Record serialization ────────────────────────────────────────────────────

function recordToRow(r: UserWeekRepoRecord): Record<string, unknown> {
  return {
    member: r.member,
    email: r.email,
    org: r.org,
    org_type: r.orgType,
    team: r.team,
    tag: r.tag,
    week: r.week,
    repo: r.repo,
    grp: r.group,
    commits: r.commits,
    active_days: r.activeDays,
    intent_feat: r.intent?.feat ?? 0,
    intent_fix: r.intent?.fix ?? 0,
    intent_refactor: r.intent?.refactor ?? 0,
    intent_docs: r.intent?.docs ?? 0,
    intent_test: r.intent?.test ?? 0,
    intent_chore: r.intent?.chore ?? 0,
    intent_other: r.intent?.other ?? 0,
    app_files: r.filetype.app.files,
    app_files_added: r.filetype.app.filesAdded ?? 0,
    app_files_deleted: r.filetype.app.filesDeleted ?? 0,
    app_ins: r.filetype.app.insertions,
    app_del: r.filetype.app.deletions,
    test_files: r.filetype.test.files,
    test_files_added: r.filetype.test.filesAdded ?? 0,
    test_files_deleted: r.filetype.test.filesDeleted ?? 0,
    test_ins: r.filetype.test.insertions,
    test_del: r.filetype.test.deletions,
    config_files: r.filetype.config.files,
    config_files_added: r.filetype.config.filesAdded ?? 0,
    config_files_deleted: r.filetype.config.filesDeleted ?? 0,
    config_ins: r.filetype.config.insertions,
    config_del: r.filetype.config.deletions,
    storybook_files: r.filetype.storybook.files,
    storybook_files_added: r.filetype.storybook.filesAdded ?? 0,
    storybook_files_deleted: r.filetype.storybook.filesDeleted ?? 0,
    storybook_ins: r.filetype.storybook.insertions,
    storybook_del: r.filetype.storybook.deletions,
    doc_files: r.filetype.doc?.files ?? 0,
    doc_files_added: r.filetype.doc?.filesAdded ?? 0,
    doc_files_deleted: r.filetype.doc?.filesDeleted ?? 0,
    doc_ins: r.filetype.doc?.insertions ?? 0,
    doc_del: r.filetype.doc?.deletions ?? 0,
  };
}

function rowToRecord(row: Record<string, unknown>): UserWeekRepoRecord {
  return {
    member: row.member as string,
    email: row.email as string,
    org: row.org as string,
    orgType: row.org_type as "core" | "consultant",
    team: row.team as string,
    tag: row.tag as string,
    week: row.week as string,
    repo: row.repo as string,
    group: row.grp as string,
    commits: row.commits as number,
    activeDays: row.active_days as number,
    intent: {
      feat: row.intent_feat as number,
      fix: row.intent_fix as number,
      refactor: row.intent_refactor as number,
      docs: row.intent_docs as number,
      test: row.intent_test as number,
      chore: row.intent_chore as number,
      other: row.intent_other as number,
    },
    filetype: {
      app: {
        files: row.app_files as number,
        filesAdded: row.app_files_added as number,
        filesDeleted: row.app_files_deleted as number,
        insertions: row.app_ins as number,
        deletions: row.app_del as number,
      },
      test: {
        files: row.test_files as number,
        filesAdded: row.test_files_added as number,
        filesDeleted: row.test_files_deleted as number,
        insertions: row.test_ins as number,
        deletions: row.test_del as number,
      },
      config: {
        files: row.config_files as number,
        filesAdded: row.config_files_added as number,
        filesDeleted: row.config_files_deleted as number,
        insertions: row.config_ins as number,
        deletions: row.config_del as number,
      },
      storybook: {
        files: row.storybook_files as number,
        filesAdded: row.storybook_files_added as number,
        filesDeleted: row.storybook_files_deleted as number,
        insertions: row.storybook_ins as number,
        deletions: row.storybook_del as number,
      },
      doc: {
        files: row.doc_files as number,
        filesAdded: row.doc_files_added as number,
        filesDeleted: row.doc_files_deleted as number,
        insertions: row.doc_ins as number,
        deletions: row.doc_del as number,
      },
    },
  };
}

// ── Meta helpers ────────────────────────────────────────────────────────────

export interface MetaTimestamps {
  commitsUpdated: string | null;
  enrichmentsUpdated: string | null;
}

/**
 * Read both data-mutation timestamps from the meta table in a single query.
 * Cheap enough to call on every TUI poll cycle (~0.01 ms on SQLite).
 */
export function getMetaTimestamps(): MetaTimestamps {
  const db = getDB();
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key IN ('commits_last_updated', 'enrichments_last_updated')")
    .all() as Array<{ key: string; value: string }>;

  let commitsUpdated: string | null = null;
  let enrichmentsUpdated: string | null = null;
  for (const r of rows) {
    if (r.key === 'commits_last_updated') commitsUpdated = r.value;
    else if (r.key === 'enrichments_last_updated') enrichmentsUpdated = r.value;
  }
  return { commitsUpdated, enrichmentsUpdated };
}

// ── Commits store (SQLite-backed) ───────────────────────────────────────────

export function loadCommitsDataSQL(): CommitsByFiletype {
  const db = getDB();
  const rows = db.prepare("SELECT * FROM records").all() as Record<string, unknown>[];
  const lastUpdated = (
    db.prepare("SELECT value FROM meta WHERE key = 'commits_last_updated'").get() as
      { value: string } | undefined
  )?.value ?? new Date().toISOString();

  return {
    version: 1,
    lastUpdated,
    records: rows.map(rowToRecord),
  };
}

export function saveCommitsDataSQL(data: CommitsByFiletype): void {
  const db = getDB();

  const upsert = db.prepare(`
    INSERT INTO records (
      member, email, org, org_type, team, tag, week, repo, grp,
      commits, active_days,
      intent_feat, intent_fix, intent_refactor, intent_docs, intent_test, intent_chore, intent_other,
      app_files, app_files_added, app_files_deleted, app_ins, app_del,
      test_files, test_files_added, test_files_deleted, test_ins, test_del,
      config_files, config_files_added, config_files_deleted, config_ins, config_del,
      storybook_files, storybook_files_added, storybook_files_deleted, storybook_ins, storybook_del,
      doc_files, doc_files_added, doc_files_deleted, doc_ins, doc_del
    ) VALUES (
      @member, @email, @org, @org_type, @team, @tag, @week, @repo, @grp,
      @commits, @active_days,
      @intent_feat, @intent_fix, @intent_refactor, @intent_docs, @intent_test, @intent_chore, @intent_other,
      @app_files, @app_files_added, @app_files_deleted, @app_ins, @app_del,
      @test_files, @test_files_added, @test_files_deleted, @test_ins, @test_del,
      @config_files, @config_files_added, @config_files_deleted, @config_ins, @config_del,
      @storybook_files, @storybook_files_added, @storybook_files_deleted, @storybook_ins, @storybook_del,
      @doc_files, @doc_files_added, @doc_files_deleted, @doc_ins, @doc_del
    )
    ON CONFLICT (member, week, repo) DO UPDATE SET
      commits = commits + excluded.commits,
      active_days = MIN(active_days + excluded.active_days, 7),
      intent_feat = intent_feat + excluded.intent_feat,
      intent_fix = intent_fix + excluded.intent_fix,
      intent_refactor = intent_refactor + excluded.intent_refactor,
      intent_docs = intent_docs + excluded.intent_docs,
      intent_test = intent_test + excluded.intent_test,
      intent_chore = intent_chore + excluded.intent_chore,
      intent_other = intent_other + excluded.intent_other,
      app_files = app_files + excluded.app_files,
      app_files_added = app_files_added + excluded.app_files_added,
      app_files_deleted = app_files_deleted + excluded.app_files_deleted,
      app_ins = app_ins + excluded.app_ins,
      app_del = app_del + excluded.app_del,
      test_files = test_files + excluded.test_files,
      test_files_added = test_files_added + excluded.test_files_added,
      test_files_deleted = test_files_deleted + excluded.test_files_deleted,
      test_ins = test_ins + excluded.test_ins,
      test_del = test_del + excluded.test_del,
      config_files = config_files + excluded.config_files,
      config_files_added = config_files_added + excluded.config_files_added,
      config_files_deleted = config_files_deleted + excluded.config_files_deleted,
      config_ins = config_ins + excluded.config_ins,
      config_del = config_del + excluded.config_del,
      storybook_files = storybook_files + excluded.storybook_files,
      storybook_files_added = storybook_files_added + excluded.storybook_files_added,
      storybook_files_deleted = storybook_files_deleted + excluded.storybook_files_deleted,
      storybook_ins = storybook_ins + excluded.storybook_ins,
      storybook_del = storybook_del + excluded.storybook_del,
      doc_files = doc_files + excluded.doc_files,
      doc_files_added = doc_files_added + excluded.doc_files_added,
      doc_files_deleted = doc_files_deleted + excluded.doc_files_deleted,
      doc_ins = doc_ins + excluded.doc_ins,
      doc_del = doc_del + excluded.doc_del
  `);

  const insertMany = db.transaction((records: UserWeekRepoRecord[]) => {
    for (const r of records) {
      upsert.run(recordToRow(r));
    }
  });

  insertMany(data.records);

  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('commits_last_updated', ?)",
  ).run(new Date().toISOString());
}

/** Query records filtered by week range, repo, org, or team. */
export function queryRecords(filters: {
  weekFrom?: string;
  weekTo?: string;
  repo?: string;
  org?: string;
  team?: string;
  tag?: string;
  group?: string;
}): UserWeekRepoRecord[] {
  const db = getDB();
  const clauses: string[] = [];
  const params: Record<string, string> = {};

  if (filters.weekFrom) {
    clauses.push("week >= @weekFrom");
    params.weekFrom = filters.weekFrom;
  }
  if (filters.weekTo) {
    clauses.push("week <= @weekTo");
    params.weekTo = filters.weekTo;
  }
  if (filters.repo) {
    clauses.push("repo = @repo");
    params.repo = filters.repo;
  }
  if (filters.org) {
    clauses.push("org = @org");
    params.org = filters.org;
  }
  if (filters.team) {
    clauses.push("team = @team");
    params.team = filters.team;
  }
  if (filters.tag) {
    clauses.push("tag = @tag");
    params.tag = filters.tag;
  }
  if (filters.group) {
    clauses.push("grp = @grp");
    params.grp = filters.group;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM records ${where}`).all(params) as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

/** Delete records older than a given week. */
export function pruneRecordsSQL(beforeWeek: string): number {
  const db = getDB();
  const result = db.prepare("DELETE FROM records WHERE week < ?").run(beforeWeek);
  return result.changes;
}

/** Get record count and week range without loading all records. */
export function getStoreStatsSQL(): {
  recordCount: number;
  oldestWeek: string | undefined;
  newestWeek: string | undefined;
} {
  const db = getDB();
  const row = db.prepare(
    "SELECT COUNT(*) as cnt, MIN(week) as oldest, MAX(week) as newest FROM records",
  ).get() as { cnt: number; oldest: string | null; newest: string | null };

  return {
    recordCount: row.cnt,
    oldestWeek: row.oldest ?? undefined,
    newestWeek: row.newest ?? undefined,
  };
}

// ── SQL-based rollup ────────────────────────────────────────────────────────

export type RollupGroupBy = 'member' | 'repo' | 'org' | 'team' | 'tag' | 'week' | 'all';

export interface RollupFilters {
  weeks?: string[];
  weekFrom?: string;
  weekTo?: string;
  org?: string;
  team?: string;
  tag?: string;
  group?: string;
  member?: string;
  repo?: string;
}

export interface FiletypeRollup {
  files: number;
  filesAdded: number;
  filesDeleted: number;
  insertions: number;
  deletions: number;
}

export interface RolledUp {
  commits: number;
  insertions: number;
  deletions: number;
  netLines: number;
  filesChanged: number;
  filesAdded: number;
  filesDeleted: number;
  activeDays: number;
  activeMembers: number;
  filetype: {
    app: FiletypeRollup;
    test: FiletypeRollup;
    config: FiletypeRollup;
    storybook: FiletypeRollup;
    doc: FiletypeRollup;
  };
}

/** Map RollupGroupBy to the SQL column name. */
const GROUP_BY_COLUMN: Record<RollupGroupBy, string> = {
  member: 'member',
  repo: 'repo',
  org: 'org',
  team: 'team',
  tag: 'tag',
  week: 'week',
  all: "'all'",  // string literal — no GROUP BY needed
};

/**
 * Aggregate records using SQL SUM() and GROUP BY.
 *
 * Replaces the JS-side `rollup()` function for production paths.
 * All filtering and grouping happens in SQLite, avoiding the cost of
 * deserializing every row into JS objects. With indexes on week, repo,
 * org, and team, this is near-instant even with millions of rows.
 */
export function queryRollup(
  filters: RollupFilters,
  groupBy: RollupGroupBy,
): Map<string, RolledUp> {
  const db = getDB();

  const groupCol = GROUP_BY_COLUMN[groupBy];
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.weeks && filters.weeks.length > 0) {
    clauses.push("week IN (SELECT value FROM json_each(@weeks_json))");
    params.weeks_json = JSON.stringify(filters.weeks);
  }
  if (filters.weekFrom) {
    clauses.push("week >= @weekFrom");
    params.weekFrom = filters.weekFrom;
  }
  if (filters.weekTo) {
    clauses.push("week <= @weekTo");
    params.weekTo = filters.weekTo;
  }
  if (filters.org !== undefined) {
    clauses.push("org = @org");
    params.org = filters.org;
  }
  if (filters.team !== undefined) {
    clauses.push("team = @team");
    params.team = filters.team;
  }
  if (filters.tag !== undefined) {
    clauses.push("tag = @tag");
    params.tag = filters.tag;
  }
  if (filters.group !== undefined) {
    clauses.push("grp = @grp");
    params.grp = filters.group;
  }
  if (filters.member !== undefined) {
    clauses.push("member = @member");
    params.member = filters.member;
  }
  if (filters.repo !== undefined) {
    clauses.push("repo = @repo");
    params.repo = filters.repo;
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const groupByClause = groupBy === 'all' ? "" : `GROUP BY ${groupCol}`;

  const sql = `
    SELECT
      ${groupCol} as group_key,
      SUM(commits) as commits,
      SUM(active_days) as active_days,
      COUNT(DISTINCT member) as active_members,
      SUM(app_files) as app_files,
      SUM(app_files_added) as app_files_added,
      SUM(app_files_deleted) as app_files_deleted,
      SUM(app_ins) as app_ins,
      SUM(app_del) as app_del,
      SUM(test_files) as test_files,
      SUM(test_files_added) as test_files_added,
      SUM(test_files_deleted) as test_files_deleted,
      SUM(test_ins) as test_ins,
      SUM(test_del) as test_del,
      SUM(config_files) as config_files,
      SUM(config_files_added) as config_files_added,
      SUM(config_files_deleted) as config_files_deleted,
      SUM(config_ins) as config_ins,
      SUM(config_del) as config_del,
      SUM(storybook_files) as storybook_files,
      SUM(storybook_files_added) as storybook_files_added,
      SUM(storybook_files_deleted) as storybook_files_deleted,
      SUM(storybook_ins) as storybook_ins,
      SUM(storybook_del) as storybook_del,
      SUM(doc_files) as doc_files,
      SUM(doc_files_added) as doc_files_added,
      SUM(doc_files_deleted) as doc_files_deleted,
      SUM(doc_ins) as doc_ins,
      SUM(doc_del) as doc_del
    FROM records
    ${where}
    ${groupByClause}
  `;

  const rows = db.prepare(sql).all(params) as Array<Record<string, number | string>>;
  const result = new Map<string, RolledUp>();

  for (const row of rows) {
    const key = String(row.group_key);
    const app: FiletypeRollup = {
      files: row.app_files as number,
      filesAdded: row.app_files_added as number,
      filesDeleted: row.app_files_deleted as number,
      insertions: row.app_ins as number,
      deletions: row.app_del as number,
    };
    const test: FiletypeRollup = {
      files: row.test_files as number,
      filesAdded: row.test_files_added as number,
      filesDeleted: row.test_files_deleted as number,
      insertions: row.test_ins as number,
      deletions: row.test_del as number,
    };
    const config: FiletypeRollup = {
      files: row.config_files as number,
      filesAdded: row.config_files_added as number,
      filesDeleted: row.config_files_deleted as number,
      insertions: row.config_ins as number,
      deletions: row.config_del as number,
    };
    const storybook: FiletypeRollup = {
      files: row.storybook_files as number,
      filesAdded: row.storybook_files_added as number,
      filesDeleted: row.storybook_files_deleted as number,
      insertions: row.storybook_ins as number,
      deletions: row.storybook_del as number,
    };
    const doc: FiletypeRollup = {
      files: row.doc_files as number,
      filesAdded: row.doc_files_added as number,
      filesDeleted: row.doc_files_deleted as number,
      insertions: row.doc_ins as number,
      deletions: row.doc_del as number,
    };

    const insertions = app.insertions + test.insertions + config.insertions + storybook.insertions + doc.insertions;
    const deletions = app.deletions + test.deletions + config.deletions + storybook.deletions + doc.deletions;
    const filesChanged = app.files + test.files + config.files + storybook.files + doc.files;
    const filesAdded = app.filesAdded + test.filesAdded + config.filesAdded + storybook.filesAdded + doc.filesAdded;
    const filesDeleted = app.filesDeleted + test.filesDeleted + config.filesDeleted + storybook.filesDeleted + doc.filesDeleted;

    result.set(key, {
      commits: row.commits as number,
      activeDays: row.active_days as number,
      activeMembers: row.active_members as number,
      insertions,
      deletions,
      netLines: insertions - deletions,
      filesChanged,
      filesAdded,
      filesDeleted,
      filetype: { app, test, config, storybook, doc },
    });
  }

  return result;
}

// ── Enrichments store (SQLite-backed) ───────────────────────────────────────

export function loadEnrichmentsSQL(): EnrichmentStore {
  const db = getDB();
  const rows = db.prepare("SELECT * FROM enrichments").all() as Array<{
    key: string;
    prs_opened: number;
    prs_merged: number;
    avg_cycle_hrs: number;
    reviews_given: number;
    churn_rate_pct: number;
    pr_feature: number;
    pr_fix: number;
    pr_bugfix: number;
    pr_chore: number;
    pr_hotfix: number;
    pr_other: number;
  }>;

  const enrichments: Record<string, ProductivityExtensions> = {};
  for (const row of rows) {
    enrichments[row.key] = {
      prs_opened: row.prs_opened,
      prs_merged: row.prs_merged,
      avg_cycle_hrs: row.avg_cycle_hrs,
      reviews_given: row.reviews_given,
      churn_rate_pct: row.churn_rate_pct,
      pr_feature: row.pr_feature ?? 0,
      pr_fix: row.pr_fix ?? 0,
      pr_bugfix: row.pr_bugfix ?? 0,
      pr_chore: row.pr_chore ?? 0,
      pr_hotfix: row.pr_hotfix ?? 0,
      pr_other: row.pr_other ?? 0,
    };
  }

  const lastUpdated = (
    db.prepare("SELECT value FROM meta WHERE key = 'enrichments_last_updated'").get() as
      { value: string } | undefined
  )?.value ?? new Date().toISOString();

  return { version: 1, lastUpdated, enrichments };
}

export function saveEnrichmentSQL(
  key: string,
  metrics: ProductivityExtensions,
): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO enrichments (key, prs_opened, prs_merged, avg_cycle_hrs, reviews_given, churn_rate_pct,
      pr_feature, pr_fix, pr_bugfix, pr_chore, pr_hotfix, pr_other)
    VALUES (@key, @prs_opened, @prs_merged, @avg_cycle_hrs, @reviews_given, @churn_rate_pct,
      @pr_feature, @pr_fix, @pr_bugfix, @pr_chore, @pr_hotfix, @pr_other)
    ON CONFLICT (key) DO UPDATE SET
      prs_opened = excluded.prs_opened,
      prs_merged = excluded.prs_merged,
      avg_cycle_hrs = excluded.avg_cycle_hrs,
      reviews_given = excluded.reviews_given,
      churn_rate_pct = excluded.churn_rate_pct,
      pr_feature = excluded.pr_feature,
      pr_fix = excluded.pr_fix,
      pr_bugfix = excluded.pr_bugfix,
      pr_chore = excluded.pr_chore,
      pr_hotfix = excluded.pr_hotfix,
      pr_other = excluded.pr_other
  `).run({
    key,
    prs_opened: metrics.prs_opened,
    prs_merged: metrics.prs_merged,
    avg_cycle_hrs: metrics.avg_cycle_hrs,
    reviews_given: metrics.reviews_given,
    churn_rate_pct: metrics.churn_rate_pct,
    pr_feature: metrics.pr_feature ?? 0,
    pr_fix: metrics.pr_fix ?? 0,
    pr_bugfix: metrics.pr_bugfix ?? 0,
    pr_chore: metrics.pr_chore ?? 0,
    pr_hotfix: metrics.pr_hotfix ?? 0,
    pr_other: metrics.pr_other ?? 0,
  });

  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('enrichments_last_updated', ?)",
  ).run(new Date().toISOString());
}

// ── Batch enrichment save ────────────────────────────────────────────────────

export function saveEnrichmentBatchSQL(
  entries: Array<{ key: string; metrics: ProductivityExtensions }>,
): void {
  const db = getDB();
  const upsert = db.prepare(`
    INSERT INTO enrichments (key, prs_opened, prs_merged, avg_cycle_hrs, reviews_given, churn_rate_pct,
      pr_feature, pr_fix, pr_bugfix, pr_chore, pr_hotfix, pr_other)
    VALUES (@key, @prs_opened, @prs_merged, @avg_cycle_hrs, @reviews_given, @churn_rate_pct,
      @pr_feature, @pr_fix, @pr_bugfix, @pr_chore, @pr_hotfix, @pr_other)
    ON CONFLICT (key) DO UPDATE SET
      prs_opened = excluded.prs_opened,
      prs_merged = excluded.prs_merged,
      avg_cycle_hrs = excluded.avg_cycle_hrs,
      reviews_given = excluded.reviews_given,
      churn_rate_pct = excluded.churn_rate_pct,
      pr_feature = excluded.pr_feature,
      pr_fix = excluded.pr_fix,
      pr_bugfix = excluded.pr_bugfix,
      pr_chore = excluded.pr_chore,
      pr_hotfix = excluded.pr_hotfix,
      pr_other = excluded.pr_other
  `);

  const insertMany = db.transaction((items: typeof entries) => {
    for (const { key, metrics } of items) {
      upsert.run({
        key,
        prs_opened: metrics.prs_opened,
        prs_merged: metrics.prs_merged,
        avg_cycle_hrs: metrics.avg_cycle_hrs,
        reviews_given: metrics.reviews_given,
        churn_rate_pct: metrics.churn_rate_pct,
        pr_feature: metrics.pr_feature ?? 0,
        pr_fix: metrics.pr_fix ?? 0,
        pr_bugfix: metrics.pr_bugfix ?? 0,
        pr_chore: metrics.pr_chore ?? 0,
        pr_hotfix: metrics.pr_hotfix ?? 0,
        pr_other: metrics.pr_other ?? 0,
      });
    }
  });

  insertMany(entries);

  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('enrichments_last_updated', ?)",
  ).run(new Date().toISOString());
}

/** Check if an enrichment key exists. */
export function hasEnrichment(key: string): boolean {
  const db = getDB();
  const row = db.prepare("SELECT 1 FROM enrichments WHERE key = ?").get(key);
  return row !== undefined;
}

/** Get a single enrichment by key, or default zeros. */
export function getEnrichmentSQL(key: string): ProductivityExtensions {
  const db = getDB();
  const row = db.prepare("SELECT * FROM enrichments WHERE key = ?").get(key) as {
    prs_opened: number;
    prs_merged: number;
    avg_cycle_hrs: number;
    reviews_given: number;
    churn_rate_pct: number;
    pr_feature: number;
    pr_fix: number;
    pr_bugfix: number;
    pr_chore: number;
    pr_hotfix: number;
    pr_other: number;
  } | undefined;

  return row ?? {
    prs_opened: 0, prs_merged: 0, avg_cycle_hrs: 0, reviews_given: 0, churn_rate_pct: 0,
    pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0,
  };
}

// ── Scan state (SQLite-backed) ──────────────────────────────────────────────

export function loadScanStateSQL(): ScanState {
  const db = getDB();
  const rows = db.prepare("SELECT * FROM scan_state").all() as Array<{
    repo: string;
    last_hash: string;
    last_scan_date: string;
    recent_hashes: string;
    record_count: number;
  }>;

  const repos: ScanState["repos"] = {};
  for (const row of rows) {
    repos[row.repo] = {
      lastHash: row.last_hash,
      lastScanDate: row.last_scan_date,
      recentHashes: JSON.parse(row.recent_hashes) as string[],
      recordCount: row.record_count,
    };
  }

  return { version: 1, repos };
}

export function saveScanStateSQL(state: ScanState): void {
  const db = getDB();
  const upsert = db.prepare(`
    INSERT INTO scan_state (repo, last_hash, last_scan_date, recent_hashes, record_count)
    VALUES (@repo, @last_hash, @last_scan_date, @recent_hashes, @record_count)
    ON CONFLICT (repo) DO UPDATE SET
      last_hash = excluded.last_hash,
      last_scan_date = excluded.last_scan_date,
      recent_hashes = excluded.recent_hashes,
      record_count = excluded.record_count
  `);

  const saveAll = db.transaction((repos: Record<string, ScanState["repos"][string]>) => {
    for (const [repo, rs] of Object.entries(repos)) {
      upsert.run({
        repo,
        last_hash: rs.lastHash,
        last_scan_date: rs.lastScanDate,
        recent_hashes: JSON.stringify(rs.recentHashes),
        record_count: rs.recordCount,
      });
    }
  });

  saveAll(state.repos);
}

export function updateRepoScanStateSQL(
  repoName: string,
  rs: ScanState["repos"][string],
): void {
  const db = getDB();
  db.prepare(`
    INSERT INTO scan_state (repo, last_hash, last_scan_date, recent_hashes, record_count)
    VALUES (@repo, @last_hash, @last_scan_date, @recent_hashes, @record_count)
    ON CONFLICT (repo) DO UPDATE SET
      last_hash = excluded.last_hash,
      last_scan_date = excluded.last_scan_date,
      recent_hashes = excluded.recent_hashes,
      record_count = excluded.record_count
  `).run({
    repo: repoName,
    last_hash: rs.lastHash,
    last_scan_date: rs.lastScanDate,
    recent_hashes: JSON.stringify(rs.recentHashes),
    record_count: rs.recordCount,
  });
}

export function deleteScanStateForRepo(repoName: string): void {
  const db = getDB();
  db.prepare("DELETE FROM scan_state WHERE repo = ?").run(repoName);
}

// ── Author registry (SQLite-backed) ─────────────────────────────────────────

export function loadAuthorRegistrySQL(): AuthorRegistry {
  const db = getDB();
  const rows = db.prepare("SELECT * FROM authors").all() as Array<{
    email: string;
    name: string;
    identifier: string | null;
    github_handle: string | null;
    org: string | null;
    team: string | null;
    first_seen: string;
    last_seen: string;
    repos_seen_in: string;
    commit_count: number;
  }>;

  const authors: Record<string, DiscoveredAuthor> = {};
  for (const row of rows) {
    authors[row.email] = {
      email: row.email,
      name: row.name,
      identifier: row.identifier ?? undefined,
      githubHandle: row.github_handle ?? undefined,
      org: row.org ?? undefined,
      team: row.team ?? undefined,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      reposSeenIn: JSON.parse(row.repos_seen_in) as string[],
      commitCount: row.commit_count,
    };
  }

  return { version: 1, authors };
}

export function saveAuthorRegistrySQL(registry: AuthorRegistry): void {
  const db = getDB();
  const upsert = db.prepare(`
    INSERT INTO authors (email, name, identifier, github_handle, org, team, first_seen, last_seen, repos_seen_in, commit_count)
    VALUES (@email, @name, @identifier, @github_handle, @org, @team, @first_seen, @last_seen, @repos_seen_in, @commit_count)
    ON CONFLICT (email) DO UPDATE SET
      name = excluded.name,
      identifier = COALESCE(excluded.identifier, authors.identifier),
      github_handle = COALESCE(excluded.github_handle, authors.github_handle),
      org = excluded.org,
      team = excluded.team,
      first_seen = MIN(authors.first_seen, excluded.first_seen),
      last_seen = MAX(authors.last_seen, excluded.last_seen),
      repos_seen_in = excluded.repos_seen_in,
      commit_count = excluded.commit_count
  `);

  const saveAll = db.transaction((authors: Record<string, DiscoveredAuthor>) => {
    for (const [key, a] of Object.entries(authors)) {
      upsert.run({
        email: key,
        name: a.name,
        identifier: a.identifier ?? null,
        github_handle: a.githubHandle ?? null,
        org: a.org ?? null,
        team: a.team ?? null,
        first_seen: a.firstSeen,
        last_seen: a.lastSeen,
        repos_seen_in: JSON.stringify(a.reposSeenIn),
        commit_count: a.commitCount,
      });
    }
  });

  saveAll(registry.authors);
}

// ── Record management ───────────────────────────────────────────────────────

/** Merge-on-write: upsert records (additive merge on conflict). */
export function upsertRecords(records: UserWeekRepoRecord[]): void {
  const db = getDB();
  const upsert = db.prepare(`
    INSERT INTO records (
      member, email, org, org_type, team, tag, week, repo, grp,
      commits, active_days,
      intent_feat, intent_fix, intent_refactor, intent_docs, intent_test, intent_chore, intent_other,
      app_files, app_files_added, app_files_deleted, app_ins, app_del,
      test_files, test_files_added, test_files_deleted, test_ins, test_del,
      config_files, config_files_added, config_files_deleted, config_ins, config_del,
      storybook_files, storybook_files_added, storybook_files_deleted, storybook_ins, storybook_del,
      doc_files, doc_files_added, doc_files_deleted, doc_ins, doc_del
    ) VALUES (
      @member, @email, @org, @org_type, @team, @tag, @week, @repo, @grp,
      @commits, @active_days,
      @intent_feat, @intent_fix, @intent_refactor, @intent_docs, @intent_test, @intent_chore, @intent_other,
      @app_files, @app_files_added, @app_files_deleted, @app_ins, @app_del,
      @test_files, @test_files_added, @test_files_deleted, @test_ins, @test_del,
      @config_files, @config_files_added, @config_files_deleted, @config_ins, @config_del,
      @storybook_files, @storybook_files_added, @storybook_files_deleted, @storybook_ins, @storybook_del,
      @doc_files, @doc_files_added, @doc_files_deleted, @doc_ins, @doc_del
    )
    ON CONFLICT (member, week, repo) DO UPDATE SET
      commits = commits + excluded.commits,
      active_days = MIN(active_days + excluded.active_days, 7),
      intent_feat = intent_feat + excluded.intent_feat,
      intent_fix = intent_fix + excluded.intent_fix,
      intent_refactor = intent_refactor + excluded.intent_refactor,
      intent_docs = intent_docs + excluded.intent_docs,
      intent_test = intent_test + excluded.intent_test,
      intent_chore = intent_chore + excluded.intent_chore,
      intent_other = intent_other + excluded.intent_other,
      app_files = app_files + excluded.app_files,
      app_files_added = app_files_added + excluded.app_files_added,
      app_files_deleted = app_files_deleted + excluded.app_files_deleted,
      app_ins = app_ins + excluded.app_ins,
      app_del = app_del + excluded.app_del,
      test_files = test_files + excluded.test_files,
      test_files_added = test_files_added + excluded.test_files_added,
      test_files_deleted = test_files_deleted + excluded.test_files_deleted,
      test_ins = test_ins + excluded.test_ins,
      test_del = test_del + excluded.test_del,
      config_files = config_files + excluded.config_files,
      config_files_added = config_files_added + excluded.config_files_added,
      config_files_deleted = config_files_deleted + excluded.config_files_deleted,
      config_ins = config_ins + excluded.config_ins,
      config_del = config_del + excluded.config_del,
      storybook_files = storybook_files + excluded.storybook_files,
      storybook_files_added = storybook_files_added + excluded.storybook_files_added,
      storybook_files_deleted = storybook_files_deleted + excluded.storybook_files_deleted,
      storybook_ins = storybook_ins + excluded.storybook_ins,
      storybook_del = storybook_del + excluded.storybook_del,
      doc_files = doc_files + excluded.doc_files,
      doc_files_added = doc_files_added + excluded.doc_files_added,
      doc_files_deleted = doc_files_deleted + excluded.doc_files_deleted,
      doc_ins = doc_ins + excluded.doc_ins,
      doc_del = doc_del + excluded.doc_del
  `);

  const insertMany = db.transaction((recs: UserWeekRepoRecord[]) => {
    for (const r of recs) {
      upsert.run(recordToRow(r));
    }
  });

  insertMany(records);

  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('commits_last_updated', ?)",
  ).run(new Date().toISOString());
}

/** Delete all records for a repo (used before rescan). */
export function deleteRecordsForRepo(repoName: string): void {
  const db = getDB();
  db.prepare("DELETE FROM records WHERE repo = ?").run(repoName);
}

/** Bulk update org/team on all records matching email. */
export function reattributeRecordsSQL(
  updates: Array<{ email: string; org: string; orgType: string; team: string; tag: string }>,
): void {
  const db = getDB();
  const stmt = db.prepare(
    "UPDATE records SET org = @org, org_type = @org_type, team = @team, tag = @tag WHERE email = @email",
  );

  const updateAll = db.transaction((items: typeof updates) => {
    for (const u of items) {
      stmt.run({
        email: u.email,
        org: u.org,
        org_type: u.orgType,
        team: u.team,
        tag: u.tag,
      });
    }
  });

  updateAll(updates);
}

// ── Enhanced stats ──────────────────────────────────────────────────────────

/** Get record count, week range, and org/team counts. */
export function getStoreStatsSQLFull(): {
  recordCount: number;
  oldestWeek: string | undefined;
  newestWeek: string | undefined;
  orgCount: number;
  teamCount: number;
} {
  const db = getDB();
  const row = db.prepare(
    "SELECT COUNT(*) as cnt, MIN(week) as oldest, MAX(week) as newest FROM records",
  ).get() as { cnt: number; oldest: string | null; newest: string | null };

  const orgRow = db.prepare(
    "SELECT COUNT(DISTINCT org) as cnt FROM records WHERE org != ''",
  ).get() as { cnt: number };

  const teamRow = db.prepare(
    "SELECT COUNT(DISTINCT team) as cnt FROM records WHERE team != ''",
  ).get() as { cnt: number };

  return {
    recordCount: row.cnt,
    oldestWeek: row.oldest ?? undefined,
    newestWeek: row.newest ?? undefined,
    orgCount: orgRow.cnt,
    teamCount: teamRow.cnt,
  };
}

// ── Reset ───────────────────────────────────────────────────────────────────

/** Delete all data from all tables. Used by --reset. */
export function resetAllData(): void {
  const db = getDB();
  db.transaction(() => {
    db.prepare("DELETE FROM records").run();
    db.prepare("DELETE FROM enrichments").run();
    db.prepare("DELETE FROM scan_state").run();
    db.prepare("DELETE FROM authors").run();
    db.prepare("DELETE FROM meta").run();
  })();
}

/** Reset the DB connection (for test isolation). */
export function resetDB(): void {
  closeDB();
}

