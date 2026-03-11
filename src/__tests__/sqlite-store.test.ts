import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { UserWeekRepoRecord } from "../types/schema.js";

function makeRecord(overrides?: Partial<UserWeekRepoRecord>): UserWeekRepoRecord {
  return {
    member: "Alice",
    email: "alice@example.com",
    org: "Acme",
    orgType: "core",
    team: "Frontend",
    tag: "default",
    week: "2026-W10",
    repo: "my-app",
    group: "default",
    commits: 5,
    activeDays: 3,
    intent: { feat: 2, fix: 1, refactor: 0, docs: 0, test: 1, chore: 1, other: 0 },
    filetype: {
      app: { files: 10, filesAdded: 3, filesDeleted: 1, insertions: 200, deletions: 50 },
      test: { files: 4, filesAdded: 2, filesDeleted: 0, insertions: 80, deletions: 10 },
      config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 5, deletions: 2 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 1, filesAdded: 1, filesDeleted: 0, insertions: 20, deletions: 0 },
    },
    ...overrides,
  };
}

describe("SQLite store", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "gitradar-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("round-trips a record through SQLite schema", () => {
    const dbPath = join(tmpDir, "test.db");
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    db.exec(`
      CREATE TABLE records (
        member TEXT NOT NULL, email TEXT NOT NULL, org TEXT NOT NULL, org_type TEXT NOT NULL,
        team TEXT NOT NULL, tag TEXT NOT NULL, week TEXT NOT NULL, repo TEXT NOT NULL, grp TEXT NOT NULL,
        commits INTEGER NOT NULL DEFAULT 0, active_days INTEGER NOT NULL DEFAULT 0,
        intent_feat INTEGER NOT NULL DEFAULT 0, intent_fix INTEGER NOT NULL DEFAULT 0,
        intent_refactor INTEGER NOT NULL DEFAULT 0, intent_docs INTEGER NOT NULL DEFAULT 0,
        intent_test INTEGER NOT NULL DEFAULT 0, intent_chore INTEGER NOT NULL DEFAULT 0,
        intent_other INTEGER NOT NULL DEFAULT 0,
        app_files INTEGER NOT NULL DEFAULT 0, app_files_added INTEGER NOT NULL DEFAULT 0,
        app_files_deleted INTEGER NOT NULL DEFAULT 0, app_ins INTEGER NOT NULL DEFAULT 0,
        app_del INTEGER NOT NULL DEFAULT 0,
        test_files INTEGER NOT NULL DEFAULT 0, test_files_added INTEGER NOT NULL DEFAULT 0,
        test_files_deleted INTEGER NOT NULL DEFAULT 0, test_ins INTEGER NOT NULL DEFAULT 0,
        test_del INTEGER NOT NULL DEFAULT 0,
        config_files INTEGER NOT NULL DEFAULT 0, config_files_added INTEGER NOT NULL DEFAULT 0,
        config_files_deleted INTEGER NOT NULL DEFAULT 0, config_ins INTEGER NOT NULL DEFAULT 0,
        config_del INTEGER NOT NULL DEFAULT 0,
        storybook_files INTEGER NOT NULL DEFAULT 0, storybook_files_added INTEGER NOT NULL DEFAULT 0,
        storybook_files_deleted INTEGER NOT NULL DEFAULT 0, storybook_ins INTEGER NOT NULL DEFAULT 0,
        storybook_del INTEGER NOT NULL DEFAULT 0,
        doc_files INTEGER NOT NULL DEFAULT 0, doc_files_added INTEGER NOT NULL DEFAULT 0,
        doc_files_deleted INTEGER NOT NULL DEFAULT 0, doc_ins INTEGER NOT NULL DEFAULT 0,
        doc_del INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (member, week, repo)
      );
    `);

    const record = makeRecord();
    const insert = db.prepare(`
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
    `);

    insert.run({
      member: record.member, email: record.email, org: record.org, org_type: record.orgType,
      team: record.team, tag: record.tag, week: record.week, repo: record.repo, grp: record.group,
      commits: record.commits, active_days: record.activeDays,
      intent_feat: record.intent?.feat ?? 0, intent_fix: record.intent?.fix ?? 0,
      intent_refactor: record.intent?.refactor ?? 0, intent_docs: record.intent?.docs ?? 0,
      intent_test: record.intent?.test ?? 0, intent_chore: record.intent?.chore ?? 0,
      intent_other: record.intent?.other ?? 0,
      app_files: record.filetype.app.files, app_files_added: record.filetype.app.filesAdded ?? 0,
      app_files_deleted: record.filetype.app.filesDeleted ?? 0,
      app_ins: record.filetype.app.insertions, app_del: record.filetype.app.deletions,
      test_files: record.filetype.test.files, test_files_added: record.filetype.test.filesAdded ?? 0,
      test_files_deleted: record.filetype.test.filesDeleted ?? 0,
      test_ins: record.filetype.test.insertions, test_del: record.filetype.test.deletions,
      config_files: record.filetype.config.files, config_files_added: record.filetype.config.filesAdded ?? 0,
      config_files_deleted: record.filetype.config.filesDeleted ?? 0,
      config_ins: record.filetype.config.insertions, config_del: record.filetype.config.deletions,
      storybook_files: record.filetype.storybook.files, storybook_files_added: record.filetype.storybook.filesAdded ?? 0,
      storybook_files_deleted: record.filetype.storybook.filesDeleted ?? 0,
      storybook_ins: record.filetype.storybook.insertions, storybook_del: record.filetype.storybook.deletions,
      doc_files: record.filetype.doc?.files ?? 0, doc_files_added: record.filetype.doc?.filesAdded ?? 0,
      doc_files_deleted: record.filetype.doc?.filesDeleted ?? 0,
      doc_ins: record.filetype.doc?.insertions ?? 0, doc_del: record.filetype.doc?.deletions ?? 0,
    });

    const row = db.prepare("SELECT * FROM records WHERE member = ?").get("Alice") as Record<string, unknown>;
    expect(row.member).toBe("Alice");
    expect(row.commits).toBe(5);
    expect(row.active_days).toBe(3);
    expect(row.intent_feat).toBe(2);
    expect(row.app_ins).toBe(200);
    expect(row.doc_files).toBe(1);

    db.close();
  });

  it("merges records with ON CONFLICT DO UPDATE (additive)", () => {
    const dbPath = join(tmpDir, "upsert.db");
    const db = new Database(dbPath);

    db.pragma("journal_mode = WAL");

    db.prepare(`
      CREATE TABLE records (
        member TEXT NOT NULL, week TEXT NOT NULL, repo TEXT NOT NULL,
        commits INTEGER NOT NULL DEFAULT 0,
        active_days INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (member, week, repo)
      )
    `).run();

    const upsert = db.prepare(`
      INSERT INTO records (member, week, repo, commits, active_days)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (member, week, repo) DO UPDATE SET
        commits = commits + excluded.commits,
        active_days = MIN(active_days + excluded.active_days, 7)
    `);
    upsert.run("Alice", "2026-W10", "app", 5, 3);
    upsert.run("Alice", "2026-W10", "app", 8, 5);

    const row = db.prepare("SELECT commits, active_days FROM records").get() as { commits: number; active_days: number };
    // Commits should be summed: 5 + 8 = 13
    expect(row.commits).toBe(13);
    // Active days should be capped at 7: MIN(3 + 5, 7) = 7
    expect(row.active_days).toBe(7);
    expect((db.prepare("SELECT COUNT(*) as cnt FROM records").get() as { cnt: number }).cnt).toBe(1);

    db.close();
  });

  it("filters records with WHERE clauses", () => {
    const dbPath = join(tmpDir, "filter.db");
    const db = new Database(dbPath);

    db.exec(`
      CREATE TABLE records (
        member TEXT, week TEXT, repo TEXT, org TEXT, team TEXT, commits INTEGER,
        PRIMARY KEY (member, week, repo)
      );
    `);

    const ins = db.prepare("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?)");
    ins.run("Alice", "2026-W10", "app", "Acme", "FE", 5);
    ins.run("Bob", "2026-W10", "app", "Acme", "BE", 3);
    ins.run("Alice", "2026-W11", "app", "Acme", "FE", 7);
    ins.run("Charlie", "2026-W10", "api", "Beta", "FE", 2);

    expect(db.prepare("SELECT * FROM records WHERE org = ?").all("Acme")).toHaveLength(3);
    expect(db.prepare("SELECT * FROM records WHERE team = ?").all("FE")).toHaveLength(3);
    expect(db.prepare("SELECT * FROM records WHERE week >= ?").all("2026-W11")).toHaveLength(1);

    db.close();
  });

  it("stores and retrieves enrichments", () => {
    const dbPath = join(tmpDir, "enrichments.db");
    const db = new Database(dbPath);

    db.pragma("journal_mode = WAL");

    db.prepare(`
      CREATE TABLE enrichments (
        key TEXT PRIMARY KEY,
        prs_opened INTEGER DEFAULT 0, prs_merged INTEGER DEFAULT 0,
        avg_cycle_hrs REAL DEFAULT 0, reviews_given INTEGER DEFAULT 0,
        churn_rate_pct REAL DEFAULT 0
      )
    `).run();

    db.prepare("INSERT INTO enrichments VALUES (?, ?, ?, ?, ?, ?)").run("Alice::2026-W10::app", 3, 2, 14.5, 5, 8.2);

    const row = db.prepare("SELECT * FROM enrichments WHERE key = ?").get("Alice::2026-W10::app") as Record<string, unknown>;
    expect(row.prs_opened).toBe(3);
    expect(row.avg_cycle_hrs).toBe(14.5);
    expect(row.churn_rate_pct).toBe(8.2);

    db.close();
  });

  it("merges enrichments with ON CONFLICT DO UPDATE (additive counts, replace rates)", () => {
    const dbPath = join(tmpDir, "enrich-merge.db");
    const db = new Database(dbPath);

    db.pragma("journal_mode = WAL");

    db.prepare(`
      CREATE TABLE enrichments (
        key TEXT PRIMARY KEY,
        prs_opened INTEGER DEFAULT 0, prs_merged INTEGER DEFAULT 0,
        avg_cycle_hrs REAL DEFAULT 0, reviews_given INTEGER DEFAULT 0,
        churn_rate_pct REAL DEFAULT 0
      )
    `).run();

    const upsert = db.prepare(`
      INSERT INTO enrichments (key, prs_opened, prs_merged, avg_cycle_hrs, reviews_given, churn_rate_pct)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET
        prs_opened = prs_opened + excluded.prs_opened,
        prs_merged = prs_merged + excluded.prs_merged,
        avg_cycle_hrs = excluded.avg_cycle_hrs,
        reviews_given = reviews_given + excluded.reviews_given,
        churn_rate_pct = excluded.churn_rate_pct
    `);

    upsert.run("Alice::2026-W10::app", 3, 2, 14.5, 5, 8.2);
    upsert.run("Alice::2026-W10::app", 1, 1, 10.0, 2, 6.0);

    const row = db.prepare("SELECT * FROM enrichments WHERE key = ?").get("Alice::2026-W10::app") as Record<string, unknown>;
    // Counts are summed
    expect(row.prs_opened).toBe(4);
    expect(row.prs_merged).toBe(3);
    expect(row.reviews_given).toBe(7);
    // Rates are replaced with latest
    expect(row.avg_cycle_hrs).toBe(10.0);
    expect(row.churn_rate_pct).toBe(6.0);

    db.close();
  });

  it("handles transaction batching for bulk inserts", () => {
    const dbPath = join(tmpDir, "batch.db");
    const db = new Database(dbPath);

    db.exec("CREATE TABLE records (member TEXT, week TEXT, repo TEXT, commits INTEGER, PRIMARY KEY (member, week, repo))");

    const ins = db.prepare("INSERT INTO records VALUES (?, ?, ?, ?)");
    const batch = db.transaction((rows: Array<[string, string, string, number]>) => {
      for (const [m, w, r, c] of rows) ins.run(m, w, r, c);
    });

    const rows: Array<[string, string, string, number]> = [];
    for (let i = 0; i < 1000; i++) rows.push([`m-${i}`, "2026-W10", "app", i]);
    batch(rows);

    expect((db.prepare("SELECT COUNT(*) as cnt FROM records").get() as { cnt: number }).cnt).toBe(1000);

    db.close();
  });

  it("prunes records by week comparison", () => {
    const dbPath = join(tmpDir, "prune.db");
    const db = new Database(dbPath);

    db.exec("CREATE TABLE records (member TEXT, week TEXT, repo TEXT, PRIMARY KEY (member, week, repo))");

    const ins = db.prepare("INSERT INTO records VALUES (?, ?, ?)");
    ins.run("Alice", "2025-W50", "app");
    ins.run("Alice", "2026-W01", "app");
    ins.run("Alice", "2026-W10", "app");

    const result = db.prepare("DELETE FROM records WHERE week < ?").run("2026-W01");
    expect(result.changes).toBe(1);
    expect((db.prepare("SELECT COUNT(*) as cnt FROM records").get() as { cnt: number }).cnt).toBe(2);

    db.close();
  });

  it("getMetaTimestamps returns nulls when meta table is empty", () => {
    const dbPath = join(tmpDir, "meta-empty.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

    const rows = db
      .prepare("SELECT key, value FROM meta WHERE key IN ('commits_last_updated', 'enrichments_last_updated')")
      .all() as Array<{ key: string; value: string }>;

    expect(rows).toHaveLength(0);
    db.close();
  });

  it("getMetaTimestamps returns both timestamps when present", () => {
    const dbPath = join(tmpDir, "meta-ts.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("commits_last_updated", "2026-03-10T12:00:00Z");
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("enrichments_last_updated", "2026-03-10T13:00:00Z");

    const rows = db
      .prepare("SELECT key, value FROM meta WHERE key IN ('commits_last_updated', 'enrichments_last_updated')")
      .all() as Array<{ key: string; value: string }>;

    expect(rows).toHaveLength(2);
    const map = new Map(rows.map(r => [r.key, r.value]));
    expect(map.get("commits_last_updated")).toBe("2026-03-10T12:00:00Z");
    expect(map.get("enrichments_last_updated")).toBe("2026-03-10T13:00:00Z");
    db.close();
  });

  it("meta timestamps update on INSERT OR REPLACE", () => {
    const dbPath = join(tmpDir, "meta-update.db");
    const db = new Database(dbPath);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('commits_last_updated', ?)").run("2026-03-10T12:00:00Z");

    const before = (db.prepare("SELECT value FROM meta WHERE key = 'commits_last_updated'").get() as { value: string }).value;
    expect(before).toBe("2026-03-10T12:00:00Z");

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('commits_last_updated', ?)").run("2026-03-10T14:00:00Z");

    const after = (db.prepare("SELECT value FROM meta WHERE key = 'commits_last_updated'").get() as { value: string }).value;
    expect(after).toBe("2026-03-10T14:00:00Z");

    db.close();
  });
});
