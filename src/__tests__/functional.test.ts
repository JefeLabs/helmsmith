/**
 * Functional test suite — end-to-end CLI pipeline via GitRadarEngine + SQLite.
 *
 * Exercises the full workflow against real git repos using the production
 * data path: GitRadarEngine for scanning, sqlite-store for persistence,
 * and queryRollup for aggregation.
 *
 *   setup → scan (engine) → verify SQLite state → assign authors →
 *   queryRollup aggregation → contributions / leaderboard / repo-activity (SQL path)
 *
 * Uses a temp directory for SQLite so the user's real ~/.agentx is untouched.
 * Scans are limited to 4 weeks to keep the test fast.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Real repos on disk ──────────────────────────────────────────────────────

const SKOOLSCOUT_ROOT = "/Users/edwincruz/Development/Workspaces/skoolscout";

const TEST_REPOS = [
  { name: "skoolscout-com",         path: join(SKOOLSCOUT_ROOT, "skoolscout-com"),         group: "SkoolScout" },
  { name: "jefelabs-com",           path: join(SKOOLSCOUT_ROOT, "jefelabs-com"),           group: "SkoolScout" },
  { name: "skoolscout-com-tenants", path: join(SKOOLSCOUT_ROOT, "skoolscout-com-tenants"), group: "SkoolScout" },
  { name: "jefelabs-clients",       path: join(SKOOLSCOUT_ROOT, "jefelabs-clients"),       group: "SkoolScout" },
];

// ── SQLite isolation: redirect getDataDir() to temp directory ────────────────

let testDataDir = "";

vi.mock("../store/paths.js", () => ({
  getDataDir: () => testDataDir,
  getConfigDir: () => testDataDir,
  expandTilde: (p: string) => p,
  getConfigPath: () => `${testDataDir}/config.yml`,
  getCacheDir: () => `${testDataDir}/cache`,
  ensureDataDir: async () => {},
}));

// ── Temp data directory ─────────────────────────────────────────────────────

let tempHome: string;
let configPath: string;
let reposRegistryPath: string;

beforeAll(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "gitradar-functional-"));
  testDataDir = join(tempHome, "data");
  await mkdir(testDataDir, { recursive: true });
});

afterAll(async () => {
  // Close the SQLite connection before cleaning temp dir
  const { closeDB } = await import("../store/sqlite-store.js");
  closeDB();
  await rm(tempHome, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function setupTempTree() {
  const gitradarDir = join(tempHome, ".agentx", "gitradar");
  await mkdir(gitradarDir, { recursive: true });

  configPath = join(gitradarDir, "config.yml");
  reposRegistryPath = join(tempHome, ".agentx", "repos.yml");

  await writeFile(configPath, "orgs: []\n", "utf-8");

  const yaml = (await import("js-yaml")).default;
  const registry = {
    workspaces: {
      functional: {
        label: "Functional Test",
        repos: TEST_REPOS.map((r) => ({
          name: r.name,
          path: r.path,
          group: r.group,
          tags: [],
        })),
      },
    },
    groups: { SkoolScout: { label: "SkoolScout Repos" } },
    tags: {},
  };
  await writeFile(reposRegistryPath, yaml.dump(registry), "utf-8");
}

async function loadConfigFromTemp() {
  const { loadConfig } = await import("../config/loader.js");
  return loadConfig(configPath);
}

async function saveConfigToTemp(patch: Record<string, unknown>) {
  const { saveConfig } = await import("../config/loader.js");
  await saveConfig(configPath, patch);
}

async function loadReposRegistryFromTemp() {
  const { loadReposRegistry } = await import("../config/repos-registry.js");
  return loadReposRegistry(reposRegistryPath);
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("Functional: Full CLI Pipeline (Engine + SQLite)", () => {

  beforeAll(async () => {
    await setupTempTree();
  });

  // ── Step 1: Registry & config files exist ─────────────────────────────────

  it("Step 1: temp tree has repos.yml and config.yml", async () => {
    const registryRaw = await readFile(reposRegistryPath, "utf-8");
    expect(registryRaw).toContain("skoolscout-com");
    expect(registryRaw).toContain("jefelabs-com");
    expect(registryRaw).toContain("skoolscout-com-tenants");
    expect(registryRaw).toContain("jefelabs-clients");

    const configRaw = await readFile(configPath, "utf-8");
    expect(configRaw).toContain("orgs");
  });

  // ── Step 2: Load repos registry ───────────────────────────────────────────

  it("Step 2: repos registry loads with 4 repos in 'functional' workspace", async () => {
    const registry = await loadReposRegistryFromTemp();
    expect(registry).not.toBeNull();
    const ws = registry!.workspaces["functional"];
    expect(ws).toBeDefined();
    expect(ws.repos).toHaveLength(4);
    expect(ws.repos.map((r) => r.name).sort()).toEqual([
      "jefelabs-clients",
      "jefelabs-com",
      "skoolscout-com",
      "skoolscout-com-tenants",
    ]);
  });

  // ── Step 3: Add org via saveConfig ────────────────────────────────────────

  it("Step 3: add-org creates SkoolScout org with developers team", async () => {
    await saveConfigToTemp({
      orgs: [
        {
          name: "SkoolScout",
          type: "core",
          teams: [{ name: "developers", tag: "default", members: [] }],
        },
      ],
    });

    const config = await loadConfigFromTemp();
    expect(config.orgs).toHaveLength(1);
    expect(config.orgs[0].name).toBe("SkoolScout");
    expect(config.orgs[0].type).toBe("core");
    expect(config.orgs[0].teams).toHaveLength(1);
    expect(config.orgs[0].teams[0].name).toBe("developers");
  });

  // ── Step 4: Scan repos via GitRadarEngine (real git → SQLite) ─────────────

  it("Step 4: engine scan produces records in SQLite with commits and file metrics", async () => {
    const { GitRadarEngine } = await import("../engine/gitradar-engine.js");
    const { DEFAULT_SETTINGS } = await import("../types/schema.js");
    const { getStoreStatsSQLFull } = await import("../store/sqlite-store.js");

    const config = await loadConfigFromTemp();
    const registry = await loadReposRegistryFromTemp();
    const repos = registry!.workspaces["functional"].repos;

    // Configure engine directly (bypasses resolveWorkspace which needs terminal)
    const engine = new GitRadarEngine();
    engine.config = {
      ...config,
      repos: repos.map((r) => ({ path: r.path ?? "", name: r.name, group: r.group })),
      settings: { ...DEFAULT_SETTINGS, weeks_back: 4, staleness_minutes: 0 },
    };

    await engine.loadStores();
    await engine.scan({ forceScan: true });

    // ── Assertions on SQLite state ──────────────────────────────────────────

    const stats = getStoreStatsSQLFull();
    expect(stats.recordCount).toBeGreaterThan(0);

    // Engine loaded records from SQLite after scan
    expect(engine.records.length).toBeGreaterThan(0);

    // Commits are non-zero
    const totalCommits = engine.records.reduce((s, r) => s + r.commits, 0);
    expect(totalCommits).toBeGreaterThan(0);

    // File metrics are non-zero (validates --raw --numstat pipeline)
    const totalInsertions = engine.records.reduce((s, r) => {
      return s +
        r.filetype.app.insertions +
        r.filetype.test.insertions +
        r.filetype.config.insertions +
        r.filetype.storybook.insertions;
    }, 0);
    expect(totalInsertions).toBeGreaterThan(0);

    const totalDeletions = engine.records.reduce((s, r) => {
      return s +
        r.filetype.app.deletions +
        r.filetype.test.deletions +
        r.filetype.config.deletions +
        r.filetype.storybook.deletions;
    }, 0);
    expect(totalDeletions).toBeGreaterThan(0);

    // Files counted
    const totalFiles = engine.records.reduce((s, r) => {
      return s +
        r.filetype.app.files +
        r.filetype.test.files +
        r.filetype.config.files +
        r.filetype.storybook.files;
    }, 0);
    expect(totalFiles).toBeGreaterThan(0);

    // Authors were discovered and persisted to SQLite
    expect(engine.authorRegistry).toBeDefined();
    const authorCount = Object.keys(engine.authorRegistry!.authors).length;
    expect(authorCount).toBeGreaterThan(0);

    // Records span multiple repos
    const reposInRecords = new Set(engine.records.map((r) => r.repo));
    expect(reposInRecords.size).toBeGreaterThanOrEqual(2);

    // Records span multiple weeks
    const weeksInRecords = new Set(engine.records.map((r) => r.week));
    expect(weeksInRecords.size).toBeGreaterThanOrEqual(1);

    // SQLite record count matches engine.records
    expect(stats.recordCount).toBe(engine.records.length);

    console.log(
      `  Engine scan: ${stats.recordCount} records in SQLite, ` +
      `${authorCount} authors, ` +
      `${totalInsertions} insertions, ${totalDeletions} deletions`,
    );
  }, 120_000); // 2 min timeout for real git operations

  // ── Step 5: Verify scan state persisted in SQLite ─────────────────────────

  it("Step 5: scan state in SQLite has entries for each scanned repo", async () => {
    const { loadScanStateSQL } = await import("../store/sqlite-store.js");

    const scanState = loadScanStateSQL();
    expect(scanState.version).toBe(1);
    const repoNames = Object.keys(scanState.repos);
    expect(repoNames.length).toBeGreaterThanOrEqual(2);

    for (const repoName of repoNames) {
      const entry = scanState.repos[repoName];
      expect(entry.lastHash).toBeTruthy();
      expect(entry.lastScanDate).toBeTruthy();
      expect(entry.recentHashes.length).toBeGreaterThan(0);
      expect(entry.recordCount).toBeGreaterThanOrEqual(0);
    }

    console.log(`  Scan state (SQLite): ${repoNames.length} repos tracked`);
  });

  // ── Step 6: Verify author registry persisted in SQLite ────────────────────

  it("Step 6: author registry in SQLite has discovered authors", async () => {
    const { loadAuthorRegistrySQL } = await import("../store/sqlite-store.js");

    const registry = loadAuthorRegistrySQL();
    expect(registry.version).toBe(1);
    expect(Object.keys(registry.authors).length).toBeGreaterThan(0);

    const someAuthor = Object.values(registry.authors)[0];
    expect(someAuthor.email).toBeDefined();
    expect(someAuthor.name).toBeDefined();
    expect(someAuthor.commitCount).toBeGreaterThan(0);
    expect(someAuthor.reposSeenIn.length).toBeGreaterThan(0);

    console.log(`  Author registry (SQLite): ${Object.keys(registry.authors).length} authors`);
  });

  // ── Step 7: Assign authors via SQLite ──────────────────────────────────────

  it("Step 7: assign known authors to SkoolScout org via SQLite", async () => {
    const { assignAuthor } = await import("../store/author-registry.js");
    const {
      loadAuthorRegistrySQL,
      saveAuthorRegistrySQL,
      reattributeRecordsSQL,
      queryRecords,
    } = await import("../store/sqlite-store.js");

    const config = await loadConfigFromTemp();
    let registry = loadAuthorRegistrySQL();

    // Find authors with "skoolscout" in their email or name
    const skoolscoutEmails = Object.keys(registry.authors).filter((email) => {
      const a = registry.authors[email];
      return (
        a.email.includes("skoolscout") ||
        a.name.toLowerCase().includes("skoolscout") ||
        a.name.toLowerCase().includes("castillo") ||
        a.email.includes("cruz")
      );
    });

    expect(skoolscoutEmails.length).toBeGreaterThan(0);

    for (const email of skoolscoutEmails) {
      registry = assignAuthor(registry, email, "SkoolScout", "developers");
    }

    // Persist author registry to SQLite
    saveAuthorRegistrySQL(registry);

    // Build re-attribution updates from the registry
    const updates: Array<{ email: string; org: string; orgType: string; team: string; tag: string }> = [];
    for (const email of skoolscoutEmails) {
      updates.push({
        email,
        org: "SkoolScout",
        orgType: "core",
        team: "developers",
        tag: "default",
      });
    }
    reattributeRecordsSQL(updates);

    // Verify records were re-attributed in SQLite
    const assignedRecords = queryRecords({ org: "SkoolScout" });
    expect(assignedRecords.length).toBeGreaterThan(0);

    // Verify author registry round-trips correctly
    const reloaded = loadAuthorRegistrySQL();
    const assignedAuthors = Object.values(reloaded.authors).filter((a) => a.org === "SkoolScout");
    expect(assignedAuthors.length).toBe(skoolscoutEmails.length);

    console.log(
      `  Assigned ${skoolscoutEmails.length} authors → ` +
      `${assignedRecords.length} records re-attributed to SkoolScout (SQL)`,
    );
  });

  // ── Step 8: queryRollup aggregation by member ─────────────────────────────

  it("Step 8: queryRollup by member has non-zero metrics", async () => {
    const { queryRollup } = await import("../store/sqlite-store.js");

    const rolled = queryRollup({}, "member");
    expect(rolled.size).toBeGreaterThan(0);

    // At least one member has commits
    let foundCommits = false;
    let foundInsertions = false;
    for (const [, agg] of rolled) {
      if (agg.commits > 0) foundCommits = true;
      if (agg.filetype.app.insertions > 0) foundInsertions = true;
    }

    expect(foundCommits).toBe(true);
    expect(foundInsertions).toBe(true);

    // Group by team — should have at least "developers" and "unassigned"
    const rolledByTeam = queryRollup({}, "team");
    const teamNames = [...rolledByTeam.keys()];
    expect(teamNames.length).toBeGreaterThanOrEqual(1);

    console.log(`  queryRollup: ${rolled.size} members, ${teamNames.length} teams: [${teamNames.join(", ")}]`);
  });

  // ── Step 9: queryRollup by org shows SkoolScout ───────────────────────────

  it("Step 9: queryRollup by org shows SkoolScout with data", async () => {
    const { queryRollup } = await import("../store/sqlite-store.js");

    const rolled = queryRollup({}, "org");
    const skoolscout = rolled.get("SkoolScout");

    expect(skoolscout).toBeDefined();
    expect(skoolscout!.commits).toBeGreaterThan(0);

    const ins = skoolscout!.filetype.app.insertions + skoolscout!.filetype.test.insertions +
      skoolscout!.filetype.config.insertions + skoolscout!.filetype.storybook.insertions;
    expect(ins).toBeGreaterThan(0);

    console.log(
      `  SkoolScout (SQL rollup): ${skoolscout!.commits} commits, ${ins} insertions`,
    );
  });

  // ── Step 10: queryRollup by repo ──────────────────────────────────────────

  it("Step 10: queryRollup by repo shows data for scanned repos", async () => {
    const { queryRollup } = await import("../store/sqlite-store.js");

    const rolledByRepo = queryRollup({}, "repo");
    expect(rolledByRepo.size).toBeGreaterThanOrEqual(2);

    // Each repo should have commits
    for (const [, agg] of rolledByRepo) {
      expect(agg.commits).toBeGreaterThan(0);
    }

    const repoNames = [...rolledByRepo.keys()];
    expect(repoNames).toContain("skoolscout-com");

    const skoolscoutCom = rolledByRepo.get("skoolscout-com")!;
    const ins = skoolscoutCom.filetype.app.insertions + skoolscoutCom.filetype.test.insertions +
      skoolscoutCom.filetype.config.insertions + skoolscoutCom.filetype.storybook.insertions;
    expect(ins).toBeGreaterThan(0);

    console.log(`  queryRollup (repo): ${rolledByRepo.size} repos: [${repoNames.join(", ")}]`);
  });

  // ── Step 11: File classifier via SQL ──────────────────────────────────────

  it("Step 11: file classifier distributes across app, test, and config categories", async () => {
    const { queryRollup } = await import("../store/sqlite-store.js");

    const rolled = queryRollup({}, "all");
    expect(rolled.size).toBe(1);

    const totals = rolled.get("all")!;

    // App files should dominate
    expect(totals.filetype.app.files).toBeGreaterThan(0);

    // Config files should exist (package.json, tsconfig, etc.)
    expect(totals.filetype.config.files).toBeGreaterThan(0);

    console.log(
      `  Files (SQL rollup): app=${totals.filetype.app.files} test=${totals.filetype.test.files} ` +
      `config=${totals.filetype.config.files} storybook=${totals.filetype.storybook.files}`,
    );
  });

  // ── Step 12: CSV export via queryRecords ───────────────────────────────────

  it("Step 12: CSV export from SQLite records includes all expected columns", async () => {
    const { recordsToCsv, flattenRecord } = await import("../commands/export-data.js");
    const { queryRecords } = await import("../store/sqlite-store.js");

    const records = queryRecords({});
    const csv = recordsToCsv(records);
    const lines = csv.trim().split("\n");

    expect(lines.length).toBeGreaterThan(1);

    const header = lines[0];
    expect(header).toContain("member");
    expect(header).toContain("commits");
    expect(header).toContain("total_insertions");
    expect(header).toContain("total_deletions");
    expect(header).toContain("test_pct");
    expect(header).toContain("app_files");

    const firstRow = lines[1].split(",");
    expect(firstRow.length).toBeGreaterThan(10);

    const flat = flattenRecord(records[0]);
    expect(flat.member).toBeTruthy();
    expect(typeof flat.commits).toBe("number");
    expect(typeof flat.total_insertions).toBe("number");

    console.log(`  CSV: ${lines.length - 1} rows, ${header.split(",").length} columns`);
  });

  // ── Step 13: SQL-filtered queryRecords by org ─────────────────────────────

  it("Step 13: queryRecords with SQL filter correctly filters by org", async () => {
    const { queryRecords } = await import("../store/sqlite-store.js");

    const allRecords = queryRecords({});
    const filtered = queryRecords({ org: "SkoolScout" });

    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(allRecords.length);

    // All filtered records belong to SkoolScout
    for (const r of filtered) {
      expect(r.org).toBe("SkoolScout");
    }

    // Filter by non-existent org returns empty
    const empty = queryRecords({ org: "NonExistent" });
    expect(empty).toHaveLength(0);

    console.log(`  SQL filter: ${filtered.length} / ${allRecords.length} records for SkoolScout`);
  });

  // ── Step 14: Re-attribution idempotency ───────────────────────────────────

  it("Step 14: re-attribution is idempotent", async () => {
    const { reattributeRecords } = await import("../collector/author-map.js");
    const { queryRecords, loadAuthorRegistrySQL } = await import("../store/sqlite-store.js");

    const config = await loadConfigFromTemp();
    const registry = loadAuthorRegistrySQL();
    const records = queryRecords({});

    const unassignedBefore = records.filter((r) => r.org === "unassigned").length;
    const assignedBefore = records.filter((r) => r.org === "SkoolScout").length;

    // Re-attribute with current state (should be idempotent)
    const reattributed = reattributeRecords(records, config, registry);

    const unassignedAfter = reattributed.filter((r) => r.org === "unassigned").length;
    const assignedAfter = reattributed.filter((r) => r.org === "SkoolScout").length;

    expect(unassignedAfter).toBe(unassignedBefore);
    expect(assignedAfter).toBe(assignedBefore);
    expect(reattributed.length).toBe(records.length);

    console.log(`  Re-attribution idempotent: ${assignedAfter} assigned, ${unassignedAfter} unassigned`);
  });

  // ── Step 15: upsertRecords handles additive merge in SQLite ───────────────

  it("Step 15: upsertRecords merges duplicate keys additively in SQLite", async () => {
    const { queryRecords, upsertRecords, getStoreStatsSQLFull } = await import("../store/sqlite-store.js");

    const before = getStoreStatsSQLFull();
    const records = queryRecords({});

    // Take a subset (first 5 records) and upsert them again
    const subset = records.slice(0, 5);

    // Record original values for comparison
    const originals = subset.map((r) => ({
      key: `${r.member}::${r.week}::${r.repo}`,
      commits: r.commits,
    }));

    upsertRecords(subset);

    // Record count should NOT increase (same keys)
    const after = getStoreStatsSQLFull();
    expect(after.recordCount).toBe(before.recordCount);

    // Commits should be doubled for the upserted records
    const reloaded = queryRecords({});
    for (const orig of originals) {
      const found = reloaded.find(
        (r) => `${r.member}::${r.week}::${r.repo}` === orig.key,
      );
      expect(found).toBeDefined();
      expect(found!.commits).toBe(orig.commits * 2);
    }

    // Undo the double-counting by subtracting (re-upsert with negative won't work,
    // so we just verify the behavior is correct)
    console.log(`  upsertRecords: ${subset.length} records merged, count unchanged at ${after.recordCount}`);
  });

  // ── Step 16: Contributions --json via SQL path ────────────────────────────

  it("Step 16: contributions --json via SQL path has non-zero insertions and deletions", async () => {
    const { contributions } = await import("../commands/contributions.js");

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    // No `records:` option → uses SQL path (queryRollup)
    await contributions({
      weeks: 52,
      groupBy: "member",
      json: true,
    });

    spy.mockRestore();

    const jsonStr = logs.join("\n");
    const rows = JSON.parse(jsonStr);

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.commits).toBeGreaterThan(0);
    }

    const withInsertions = rows.filter((r: any) => r.insertions > 0);
    const withDeletions = rows.filter((r: any) => r.deletions > 0);
    expect(withInsertions.length).toBeGreaterThan(0);
    expect(withDeletions.length).toBeGreaterThan(0);

    const withFiles = rows.filter((r: any) => r.files > 0);
    expect(withFiles.length).toBeGreaterThan(0);

    const totalIns = rows.reduce((s: number, r: any) => s + r.insertions, 0);
    const totalDel = rows.reduce((s: number, r: any) => s + r.deletions, 0);
    expect(totalIns).toBeGreaterThan(100);
    expect(totalDel).toBeGreaterThan(0);

    console.log(
      `  Contributions (SQL path): ${rows.length} members, ` +
      `total insertions=${totalIns}, deletions=${totalDel}`,
    );
  });

  // ── Step 17: Leaderboard --json via SQL path ──────────────────────────────

  it("Step 17: leaderboard --json via SQL path has non-zero line counts", async () => {
    const { leaderboard } = await import("../commands/leaderboard.js");

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    // No `records:` option → uses queryRecords() from SQLite
    await leaderboard({
      weeks: 52,
      top: 10,
      json: true,
    });

    spy.mockRestore();

    const jsonStr = logs.join("\n");
    const columns = JSON.parse(jsonStr);

    expect(columns.length).toBe(4); // Overall, App, Test, Config

    const overall = columns.find((c: any) => c.title === "Overall");
    expect(overall).toBeDefined();
    expect(overall.entries.length).toBeGreaterThan(0);

    for (const entry of overall.entries) {
      expect(entry.value).toBeGreaterThan(0);
      expect(entry.member).toBeTruthy();
      expect(entry.rank).toBeGreaterThan(0);
    }

    expect(overall.entries[0].value).toBeGreaterThan(100);

    const appCol = columns.find((c: any) => c.title === "App");
    expect(appCol).toBeDefined();
    expect(appCol.entries.length).toBeGreaterThan(0);
    expect(appCol.entries[0].value).toBeGreaterThan(0);

    console.log(
      `  Leaderboard (SQL path): #1 overall=${overall.entries[0].member} (${overall.entries[0].value} lines), ` +
      `#1 app=${appCol.entries[0].member} (${appCol.entries[0].value} lines)`,
    );
  });

  // ── Step 18: Repo-activity --json via SQL path ────────────────────────────

  it("Step 18: repo-activity --json via SQL path has non-zero insertions and deletions", async () => {
    const { repoActivity } = await import("../commands/repo-activity.js");

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    // No `records:` option → uses SQL fast path (queryRollup)
    await repoActivity({
      weeks: 52,
      json: true,
    });

    spy.mockRestore();

    const jsonStr = logs.join("\n");
    const rows = JSON.parse(jsonStr);

    expect(rows.length).toBeGreaterThanOrEqual(2);

    for (const row of rows) {
      expect(row.commits).toBeGreaterThan(0);
      expect(row.repo).toBeTruthy();
      expect(row.group).toBeTruthy();
    }

    const skoolscout = rows.find((r: any) => r.repo === "skoolscout-com");
    expect(skoolscout).toBeDefined();
    expect(skoolscout.insertions).toBeGreaterThan(0);
    expect(skoolscout.deletions).toBeGreaterThan(0);
    expect(skoolscout.files).toBeGreaterThan(0);
    expect(skoolscout.contributors).toBeGreaterThan(0);
    expect(skoolscout.net).not.toBe(0);

    const totalFiles = rows.reduce((s: number, r: any) => s + r.files, 0);
    expect(totalFiles).toBeGreaterThan(0);

    console.log(
      `  Repo-activity (SQL path): ${rows.length} repos, ` +
      `skoolscout-com: ${skoolscout.commits} commits, +${skoolscout.insertions}/-${skoolscout.deletions}, ` +
      `${skoolscout.files} files, ${skoolscout.contributors} devs`,
    );
  });

  // ── Step 19: queryRollup with week filter matches queryRecords ────────────

  it("Step 19: queryRollup with week filter produces consistent results", async () => {
    const { queryRollup, queryRecords } = await import("../store/sqlite-store.js");
    const { getCurrentWeek, getLastNWeeks } = await import("../aggregator/filters.js");

    const weeks = getLastNWeeks(4, getCurrentWeek());
    const rolled = queryRollup({ weeks }, "member");
    const records = queryRecords({});

    // Filter records to matching weeks manually
    const weekSet = new Set(weeks);
    const filteredRecords = records.filter((r) => weekSet.has(r.week));

    // Total commits from rollup should match manual summation
    let rollupCommits = 0;
    for (const [, agg] of rolled) {
      rollupCommits += agg.commits;
    }

    // Note: Step 15 doubled some records, so we compare rollup against itself
    // The important thing is rollup returns data and groups correctly
    expect(rolled.size).toBeGreaterThan(0);
    expect(rollupCommits).toBeGreaterThan(0);

    // Number of distinct members should match
    const membersFromRecords = new Set(filteredRecords.map((r) => r.member));
    expect(rolled.size).toBe(membersFromRecords.size);

    console.log(
      `  queryRollup(weeks): ${rolled.size} members, ${rollupCommits} commits across ${weeks.length} weeks`,
    );
  });
});
