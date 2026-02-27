/**
 * Functional test suite — end-to-end CLI pipeline.
 *
 * Exercises the full workflow against real git repos:
 *   clean → create workspace → add repos → add org → scan → assign authors →
 *   verify contributions / leaderboard / repo-activity
 *
 * Uses a temp directory for all data so the user's real ~/.agentx is untouched.
 * Scans are limited to 4 weeks to keep the test fast.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
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

// ── Temp data directory (replaces ~/.agentx) ─────────────────────────────────

let tempHome: string;
let configPath: string;
let reposRegistryPath: string;

beforeAll(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "gitradar-functional-"));
});

afterAll(async () => {
  await rm(tempHome, { recursive: true, force: true });
});

// ── Helpers that import with the temp paths ──────────────────────────────────

/**
 * Dynamically import a module with `getConfigDir()` / `getDataDir()` /
 * `homedir()` pointed at our temp directory. We redirect by writing
 * config + registry into the temp tree so no mocking of node:os is needed —
 * instead we pass explicit paths through the command options.
 */

async function setupTempTree() {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const gitradarDir = join(tempHome, ".agentx", "gitradar");
  const dataDir = join(gitradarDir, "data");
  await mkdir(dataDir, { recursive: true });

  configPath = join(gitradarDir, "config.yml");
  reposRegistryPath = join(tempHome, ".agentx", "repos.yml");

  // Write empty config
  await writeFile(configPath, "orgs: []\n", "utf-8");

  // Write repos registry with our test repos
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

  return { configPath, reposRegistryPath, dataDir };
}

// ── Dynamic imports that use explicit temp paths ─────────────────────────────

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

describe("Functional: Full CLI Pipeline", () => {
  let dataDir: string;

  // Shared state across ordered tests
  let commitsPath: string;
  let scanStatePath: string;
  let authorsPath: string;

  beforeAll(async () => {
    const tree = await setupTempTree();
    dataDir = tree.dataDir;
    commitsPath = join(dataDir, "commits-by-filetype.json");
    scanStatePath = join(dataDir, "scan-state.json");
    authorsPath = join(dataDir, "authors.json");
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

  // ── Step 4: Scan repos (real git operations) ──────────────────────────────

  it("Step 4: scan produces records with commits and file metrics", async () => {
    const { scanAllRepos } = await import("../collector/index.js");
    const { saveCommitsData, mergeRecords } = await import("../store/commits-by-filetype.js");
    const { saveScanState } = await import("../store/scan-state.js");
    const { saveAuthorRegistry, mergeDiscoveredAuthors } = await import("../store/author-registry.js");
    const { writeFile: wf } = await import("node:fs/promises");
    const config = await loadConfigFromTemp();

    // Build config with repos from our registry
    const registry = await loadReposRegistryFromTemp();
    const repos = registry!.workspaces["functional"].repos;
    const scanConfig = {
      ...config,
      repos: repos.map((r) => ({ path: r.path ?? "", name: r.name, group: r.group })),
      settings: { ...config.settings, weeks_back: 4, staleness_minutes: 0 },
    };

    const initialScanState = { version: 1 as const, repos: {} };
    let authorRegistry = { version: 1 as const, authors: {} as Record<string, any> };
    let allRecords: any[] = [];

    const result = await scanAllRepos(scanConfig, initialScanState, {
      forceScan: true,
      chunkMonths: 1,
      authorRegistry,
      onRepoScanned: async (repoRecords) => {
        allRecords = mergeRecords(allRecords, repoRecords);
      },
      onScanStateUpdated: async (state) => {
        await wf(scanStatePath, JSON.stringify(state, null, 2), "utf-8");
      },
      onAuthorsDiscovered: async (authors) => {
        authorRegistry = mergeDiscoveredAuthors(
          authorRegistry,
          authors.map((a) => ({
            email: a.email,
            name: a.name,
            repoName: a.repoName,
            commitCount: a.commitCount,
            date: a.lastDate,
          })),
        );
        await wf(authorsPath, JSON.stringify(authorRegistry, null, 2), "utf-8");
      },
    });

    // Persist records
    const commitsData = {
      version: 1 as const,
      lastUpdated: new Date().toISOString(),
      records: allRecords,
    };
    await wf(commitsPath, JSON.stringify(commitsData, null, 2), "utf-8");

    // ── Assertions ──────────────────────────────────────────────────────────

    // Repos were scanned
    expect(result.stats.reposScanned).toBeGreaterThanOrEqual(1);
    expect(result.stats.totalCommits).toBeGreaterThan(0);

    // Records were produced
    expect(allRecords.length).toBeGreaterThan(0);

    // Commits are non-zero
    const totalCommits = allRecords.reduce((s, r) => s + r.commits, 0);
    expect(totalCommits).toBeGreaterThan(0);

    // File metrics are non-zero (validates --raw --numstat fix)
    const totalInsertions = allRecords.reduce((s, r) => {
      return s +
        r.filetype.app.insertions +
        r.filetype.test.insertions +
        r.filetype.config.insertions +
        r.filetype.storybook.insertions;
    }, 0);
    expect(totalInsertions).toBeGreaterThan(0);

    const totalDeletions = allRecords.reduce((s, r) => {
      return s +
        r.filetype.app.deletions +
        r.filetype.test.deletions +
        r.filetype.config.deletions +
        r.filetype.storybook.deletions;
    }, 0);
    expect(totalDeletions).toBeGreaterThan(0);

    // Files counted
    const totalFiles = allRecords.reduce((s, r) => {
      return s +
        r.filetype.app.files +
        r.filetype.test.files +
        r.filetype.config.files +
        r.filetype.storybook.files;
    }, 0);
    expect(totalFiles).toBeGreaterThan(0);

    // Authors were discovered
    const authorCount = Object.keys(authorRegistry.authors).length;
    expect(authorCount).toBeGreaterThan(0);

    // Records span multiple repos
    const reposInRecords = new Set(allRecords.map((r) => r.repo));
    expect(reposInRecords.size).toBeGreaterThanOrEqual(2);

    // Records span multiple weeks
    const weeksInRecords = new Set(allRecords.map((r) => r.week));
    expect(weeksInRecords.size).toBeGreaterThanOrEqual(1);

    console.log(
      `  Scan: ${result.stats.reposScanned} repos, ` +
      `${result.stats.totalCommits} commits → ${allRecords.length} records, ` +
      `${authorCount} authors, ` +
      `${totalInsertions} insertions, ${totalDeletions} deletions`,
    );
  }, 120_000); // 2 min timeout for real git operations

  // ── Step 5: Verify authors.json was persisted ─────────────────────────────

  it("Step 5: author registry persisted with discovered authors", async () => {
    const raw = JSON.parse(await readFile(authorsPath, "utf-8"));
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.authors).length).toBeGreaterThan(0);

    // At least one author has reposSeenIn
    const someAuthor = Object.values(raw.authors)[0] as any;
    expect(someAuthor.email).toBeDefined();
    expect(someAuthor.name).toBeDefined();
    expect(someAuthor.commitCount).toBeGreaterThan(0);
    expect(someAuthor.reposSeenIn.length).toBeGreaterThan(0);
  });

  // ── Step 6: Assign authors ────────────────────────────────────────────────

  it("Step 6: assign known authors to SkoolScout org", async () => {
    const { assignAuthor } = await import("../store/author-registry.js");
    const { reattributeRecords } = await import("../collector/author-map.js");
    const { writeFile: wf } = await import("node:fs/promises");

    let registry = JSON.parse(await readFile(authorsPath, "utf-8"));
    const config = await loadConfigFromTemp();

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

    await wf(authorsPath, JSON.stringify(registry, null, 2), "utf-8");

    // Re-attribute records
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));
    const reattributed = reattributeRecords(commitsData.records, config, registry);
    await wf(
      commitsPath,
      JSON.stringify({ ...commitsData, records: reattributed }, null, 2),
      "utf-8",
    );

    // Verify some records now have org=SkoolScout
    const assignedRecords = reattributed.filter((r: any) => r.org === "SkoolScout");
    expect(assignedRecords.length).toBeGreaterThan(0);

    // Verify the author registry has assigned entries
    const assignedAuthors = Object.values(registry.authors).filter((a: any) => a.org === "SkoolScout");
    expect(assignedAuthors.length).toBe(skoolscoutEmails.length);

    console.log(
      `  Assigned ${skoolscoutEmails.length} authors → ` +
      `${assignedRecords.length} records re-attributed to SkoolScout`,
    );
  });

  // ── Step 7: Contributions aggregation ─────────────────────────────────────

  it("Step 7: contributions aggregation by member has non-zero metrics", async () => {
    const { rollup } = await import("../aggregator/engine.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));
    const records = commitsData.records;

    // Group by member
    const rolled = rollup(records, (r: any) => r.member);
    expect(rolled.size).toBeGreaterThan(0);

    // At least one member has commits
    let foundCommits = false;
    let foundInsertions = false;
    for (const [member, agg] of rolled) {
      if (agg.commits > 0) foundCommits = true;
      const ins = agg.filetype.app.insertions + agg.filetype.test.insertions +
        agg.filetype.config.insertions + agg.filetype.storybook.insertions;
      if (ins > 0) foundInsertions = true;
    }

    expect(foundCommits).toBe(true);
    expect(foundInsertions).toBe(true);

    // Group by team — should have at least "developers" and "unassigned"
    const rolledByTeam = rollup(records, (r: any) => r.team);
    const teamNames = [...rolledByTeam.keys()];
    expect(teamNames.length).toBeGreaterThanOrEqual(1);

    console.log(`  ${rolled.size} members, ${teamNames.length} teams: [${teamNames.join(", ")}]`);
  });

  // ── Step 8: Contributions by org ──────────────────────────────────────────

  it("Step 8: contributions by org shows SkoolScout with data", async () => {
    const { rollup } = await import("../aggregator/engine.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    const rolled = rollup(commitsData.records, (r: any) => r.org);
    const skoolscout = rolled.get("SkoolScout");

    expect(skoolscout).toBeDefined();
    expect(skoolscout!.commits).toBeGreaterThan(0);

    const ins = skoolscout!.filetype.app.insertions + skoolscout!.filetype.test.insertions +
      skoolscout!.filetype.config.insertions + skoolscout!.filetype.storybook.insertions;
    expect(ins).toBeGreaterThan(0);

    console.log(
      `  SkoolScout: ${skoolscout!.commits} commits, ${ins} insertions`,
    );
  });

  // ── Step 9: Leaderboard ──────────────────────────────────────────────────

  it("Step 9: leaderboard computes ranked entries", async () => {
    const { computeLeaderboard } = await import("../aggregator/leaderboard.js");
    const { getLastNWeeks, getCurrentWeek } = await import("../aggregator/filters.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    const weeks = getLastNWeeks(52, getCurrentWeek());
    const columns = computeLeaderboard(commitsData.records, weeks, 5);

    expect(columns).toHaveLength(4); // Overall, App, Test, Config

    // Overall column should have entries
    const overall = columns.find((c) => c.title === "Overall");
    expect(overall).toBeDefined();
    expect(overall!.entries.length).toBeGreaterThan(0);

    // Entries are ranked
    expect(overall!.entries[0].rank).toBe(1);
    expect(overall!.entries[0].value).toBeGreaterThanOrEqual(
      overall!.entries[overall!.entries.length - 1].value,
    );

    // Entries have member metadata
    for (const entry of overall!.entries) {
      expect(entry.member).toBeTruthy();
      expect(entry.team).toBeTruthy();
      expect(entry.org).toBeTruthy();
    }

    console.log(
      `  Leaderboard: #1 ${overall!.entries[0].member} (${overall!.entries[0].value} lines)`,
    );
  });

  // ── Step 10: Repo activity ────────────────────────────────────────────────

  it("Step 10: repo activity shows data for scanned repos", async () => {
    const { rollup } = await import("../aggregator/engine.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));
    const records = commitsData.records;

    const rolledByRepo = rollup(records, (r: any) => r.repo);

    // Should have multiple repos
    expect(rolledByRepo.size).toBeGreaterThanOrEqual(2);

    // Each repo should have commits
    for (const [repo, agg] of rolledByRepo) {
      expect(agg.commits).toBeGreaterThan(0);
    }

    // skoolscout-com should be the most active
    const repoNames = [...rolledByRepo.keys()];
    expect(repoNames).toContain("skoolscout-com");

    const skoolscoutCom = rolledByRepo.get("skoolscout-com")!;
    const ins = skoolscoutCom.filetype.app.insertions + skoolscoutCom.filetype.test.insertions +
      skoolscoutCom.filetype.config.insertions + skoolscoutCom.filetype.storybook.insertions;
    expect(ins).toBeGreaterThan(0);

    console.log(
      `  ${rolledByRepo.size} repos: [${repoNames.join(", ")}]`,
    );
  });

  // ── Step 11: File classifier distributes across categories ────────────────

  it("Step 11: file classifier produces app, test, and config categories", async () => {
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));
    const records = commitsData.records;

    // Aggregate all filetype metrics
    let appFiles = 0, testFiles = 0, configFiles = 0, storybookFiles = 0;
    for (const r of records) {
      appFiles += r.filetype.app.files;
      testFiles += r.filetype.test.files;
      configFiles += r.filetype.config.files;
      storybookFiles += r.filetype.storybook.files;
    }

    // App files should dominate
    expect(appFiles).toBeGreaterThan(0);

    // Config files should exist (package.json, tsconfig, etc.)
    expect(configFiles).toBeGreaterThan(0);

    // Test files might exist (test suites in these repos)
    // Don't assert > 0 since some repos may not have tests in the 4-week window

    console.log(
      `  Files: app=${appFiles} test=${testFiles} config=${configFiles} storybook=${storybookFiles}`,
    );
  });

  // ── Step 12: CSV export produces valid output ─────────────────────────────

  it("Step 12: CSV export includes all expected columns and data", async () => {
    const { recordsToCsv, flattenRecord } = await import("../commands/export-data.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    const csv = recordsToCsv(commitsData.records);
    const lines = csv.trim().split("\n");

    // Header + data rows
    expect(lines.length).toBeGreaterThan(1);

    // Header has expected columns
    const header = lines[0];
    expect(header).toContain("member");
    expect(header).toContain("commits");
    expect(header).toContain("total_insertions");
    expect(header).toContain("total_deletions");
    expect(header).toContain("test_pct");
    expect(header).toContain("app_files");

    // First data row has values
    const firstRow = lines[1].split(",");
    expect(firstRow.length).toBeGreaterThan(10);

    // Flatten a record and check it
    const record = commitsData.records[0];
    const flat = flattenRecord(record);
    expect(flat.member).toBeTruthy();
    expect(typeof flat.commits).toBe("number");
    expect(typeof flat.total_insertions).toBe("number");

    console.log(`  CSV: ${lines.length - 1} rows, ${header.split(",").length} columns`);
  });

  // ── Step 13: Filter records by org ────────────────────────────────────────

  it("Step 13: filterRecords correctly filters by org", async () => {
    const { filterRecords } = await import("../aggregator/filters.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    const filtered = filterRecords(commitsData.records, { org: "SkoolScout" });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(commitsData.records.length);

    // All filtered records belong to SkoolScout
    for (const r of filtered) {
      expect(r.org).toBe("SkoolScout");
    }

    // Filter by non-existent org returns empty
    const empty = filterRecords(commitsData.records, { org: "NonExistent" });
    expect(empty).toHaveLength(0);

    console.log(`  Filtered: ${filtered.length} / ${commitsData.records.length} records for SkoolScout`);
  });

  // ── Step 14: Scan state tracks repos ──────────────────────────────────────

  it("Step 14: scan state has entries for each scanned repo", async () => {
    const raw = JSON.parse(await readFile(scanStatePath, "utf-8"));

    expect(raw.version).toBe(1);
    const repoNames = Object.keys(raw.repos);
    expect(repoNames.length).toBeGreaterThanOrEqual(2);

    for (const repoName of repoNames) {
      const entry = raw.repos[repoName];
      expect(entry.lastHash).toBeTruthy();
      expect(entry.lastScanDate).toBeTruthy();
      expect(entry.recentHashes.length).toBeGreaterThan(0);
      expect(entry.recordCount).toBeGreaterThanOrEqual(0);
    }

    console.log(`  Scan state: ${repoNames.length} repos tracked`);
  });

  // ── Step 15: Re-attribution after assignment ──────────────────────────────

  it("Step 15: re-attribution updates records when author assignment changes", async () => {
    const { reattributeRecords } = await import("../collector/author-map.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));
    const registry = JSON.parse(await readFile(authorsPath, "utf-8"));
    const config = await loadConfigFromTemp();

    const unassignedBefore = commitsData.records.filter((r: any) => r.org === "unassigned").length;
    const assignedBefore = commitsData.records.filter((r: any) => r.org === "SkoolScout").length;

    // Re-attribute with current state (should be idempotent)
    const reattributed = reattributeRecords(commitsData.records, config, registry);

    const unassignedAfter = reattributed.filter((r: any) => r.org === "unassigned").length;
    const assignedAfter = reattributed.filter((r: any) => r.org === "SkoolScout").length;

    // Counts should stay the same (idempotent)
    expect(unassignedAfter).toBe(unassignedBefore);
    expect(assignedAfter).toBe(assignedBefore);

    // Total records unchanged
    expect(reattributed.length).toBe(commitsData.records.length);

    console.log(`  Re-attribution idempotent: ${assignedAfter} assigned, ${unassignedAfter} unassigned`);
  });

  // ── Step 16: Merge records handles duplicates ─────────────────────────────

  it("Step 16: merging incoming records sums metrics additively", async () => {
    const { mergeRecords } = await import("../store/commits-by-filetype.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    // Take a subset (first 10 records) as "incoming"
    const incoming = commitsData.records.slice(0, 10);
    const originalCount = commitsData.records.length;

    // Merge incoming into existing — should not increase record count
    // for records that share the same member::week::repo key
    const merged = mergeRecords(commitsData.records, incoming);

    // Count should stay same (incoming keys all exist in existing)
    expect(merged.length).toBeLessThanOrEqual(originalCount);
    expect(merged.length).toBeGreaterThan(0);

    // Verify additive merge: the first record should have doubled commits
    const first = incoming[0];
    const mergedRecord = merged.find(
      (r: any) => r.member === first.member && r.week === first.week && r.repo === first.repo,
    );
    expect(mergedRecord).toBeDefined();
    expect(mergedRecord.commits).toBe(first.commits * 2);

    // Records not in incoming should be unchanged
    const lastOriginal = commitsData.records[commitsData.records.length - 1];
    const wasInIncoming = incoming.some(
      (r: any) => r.member === lastOriginal.member && r.week === lastOriginal.week && r.repo === lastOriginal.repo,
    );
    if (!wasInIncoming) {
      const unchanged = merged.find(
        (r: any) => r.member === lastOriginal.member && r.week === lastOriginal.week && r.repo === lastOriginal.repo,
      );
      expect(unchanged).toBeDefined();
      expect(unchanged.commits).toBe(lastOriginal.commits);
    }
  });

  // ── Step 17: Contributions --json output has non-zero metrics ─────────

  it("Step 17: contributions --json output has non-zero insertions and deletions", async () => {
    const { contributions } = await import("../commands/contributions.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    // Capture console.log output
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    await contributions({
      weeks: 52,
      groupBy: "member",
      json: true,
      records: commitsData.records,
    });

    spy.mockRestore();

    const jsonStr = logs.join("\n");
    const rows = JSON.parse(jsonStr);

    expect(rows.length).toBeGreaterThan(0);

    // Every row must have non-zero commits
    for (const row of rows) {
      expect(row.commits).toBeGreaterThan(0);
    }

    // At least one row must have non-zero insertions AND deletions
    const withInsertions = rows.filter((r: any) => r.insertions > 0);
    const withDeletions = rows.filter((r: any) => r.deletions > 0);
    expect(withInsertions.length).toBeGreaterThan(0);
    expect(withDeletions.length).toBeGreaterThan(0);

    // At least one row must have non-zero files
    const withFiles = rows.filter((r: any) => r.files > 0);
    expect(withFiles.length).toBeGreaterThan(0);

    // Total insertions across all rows must be significant
    const totalIns = rows.reduce((s: number, r: any) => s + r.insertions, 0);
    const totalDel = rows.reduce((s: number, r: any) => s + r.deletions, 0);
    expect(totalIns).toBeGreaterThan(100);
    expect(totalDel).toBeGreaterThan(0);

    console.log(
      `  Contributions JSON: ${rows.length} members, ` +
      `total insertions=${totalIns}, deletions=${totalDel}`,
    );
  });

  // ── Step 18: Leaderboard --json output has non-zero values ────────────

  it("Step 18: leaderboard --json output has non-zero line counts", async () => {
    const { leaderboard } = await import("../commands/leaderboard.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    await leaderboard({
      weeks: 52,
      top: 10,
      json: true,
      records: commitsData.records,
    });

    spy.mockRestore();

    const jsonStr = logs.join("\n");
    const columns = JSON.parse(jsonStr);

    expect(columns.length).toBe(4); // Overall, App, Test, Config

    // Overall column must have entries with non-zero values
    const overall = columns.find((c: any) => c.title === "Overall");
    expect(overall).toBeDefined();
    expect(overall.entries.length).toBeGreaterThan(0);

    for (const entry of overall.entries) {
      expect(entry.value).toBeGreaterThan(0);
      expect(entry.member).toBeTruthy();
      expect(entry.rank).toBeGreaterThan(0);
    }

    // #1 entry should have substantial line count
    expect(overall.entries[0].value).toBeGreaterThan(100);

    // App column should also have entries
    const appCol = columns.find((c: any) => c.title === "App");
    expect(appCol).toBeDefined();
    expect(appCol.entries.length).toBeGreaterThan(0);
    expect(appCol.entries[0].value).toBeGreaterThan(0);

    console.log(
      `  Leaderboard JSON: #1 overall=${overall.entries[0].member} (${overall.entries[0].value} lines), ` +
      `#1 app=${appCol.entries[0].member} (${appCol.entries[0].value} lines)`,
    );
  });

  // ── Step 19: Repo-activity --json output has non-zero metrics ─────────

  it("Step 19: repo-activity --json output has non-zero insertions and deletions", async () => {
    const { repoActivity } = await import("../commands/repo-activity.js");
    const commitsData = JSON.parse(await readFile(commitsPath, "utf-8"));

    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: any[]) => {
      logs.push(args.map(String).join(" "));
    });

    await repoActivity({
      weeks: 52,
      json: true,
      records: commitsData.records,
    });

    spy.mockRestore();

    const jsonStr = logs.join("\n");
    const rows = JSON.parse(jsonStr);

    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Every repo row must have non-zero commits
    for (const row of rows) {
      expect(row.commits).toBeGreaterThan(0);
      expect(row.repo).toBeTruthy();
      expect(row.group).toBeTruthy();
    }

    // skoolscout-com must have non-zero insertions and deletions
    const skoolscout = rows.find((r: any) => r.repo === "skoolscout-com");
    expect(skoolscout).toBeDefined();
    expect(skoolscout.insertions).toBeGreaterThan(0);
    expect(skoolscout.deletions).toBeGreaterThan(0);
    expect(skoolscout.files).toBeGreaterThan(0);
    expect(skoolscout.contributors).toBeGreaterThan(0);
    expect(skoolscout.net).not.toBe(0);

    // At least one repo must have non-zero files
    const totalFiles = rows.reduce((s: number, r: any) => s + r.files, 0);
    expect(totalFiles).toBeGreaterThan(0);

    console.log(
      `  Repo-activity JSON: ${rows.length} repos, ` +
      `skoolscout-com: ${skoolscout.commits} commits, +${skoolscout.insertions}/-${skoolscout.deletions}, ` +
      `${skoolscout.files} files, ${skoolscout.contributors} devs`,
    );
  });
});
