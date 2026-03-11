import { Command } from 'commander';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { loadConfig, saveConfig } from './config/loader.js';
import { detectGitRoot } from './config/git-root.js';
import {
  loadAllRegistries,
  getAvailableWorkspaces,
  addReposToWorkspace,
  removeRepoFromWorkspace,
  saveReposRegistry,
  createWorkspace,
} from './config/repos-registry.js';
import type { LoadedWorkspace } from './config/repos-registry.js';
import { scanDirectory } from './collector/dir-scanner.js';
import { readKey } from './ui/keypress.js';
import { selectWorkspace } from './config/workspace-selector.js';
import { loadScanState, saveScanState } from './store/scan-state.js';
import {
  loadCommitsData,
  saveCommitsData,
  mergeRecords,
  pruneOldRecords,
  getStoreStats,
} from './store/commits-by-filetype.js';
import {
  loadAuthorRegistry,
  saveAuthorRegistry,
  mergeDiscoveredAuthors,
} from './store/author-registry.js';
import { getCommitsPath, getScanStatePath, getAuthorRegistryPath, getEnrichmentsPath, getConfigDir, getDataDir, getConfigPath } from './store/paths.js';
import { scanAllRepos } from './collector/index.js';
import { getCurrentWeek } from './aggregator/filters.js';
import { filterRecords } from './aggregator/filters.js';
import { reattributeRecords } from './collector/author-map.js';
import { runNavigator } from './views/navigator.js';
import { dashboardView } from './views/dashboard.js';
import { trendsView } from './views/trends.js';
import { generateDemoData } from './demo.js';
import type { ViewContext } from './views/types.js';
import type { Config, Org, UserWeekRepoRecord, AuthorRegistry, ScanState } from './types/schema.js';

const program = new Command();

/** Shorthand to read global options from the root program. */
function globals() {
  return program.opts<{
    config?: string;
    weeks?: number;
    team?: string;
    org?: string;
    tag?: string;
    group?: string;
    demo?: boolean;
    json?: boolean;
    forceScan?: boolean;
    prune?: number;
    storeStats?: boolean;
    reset?: boolean;
    staleness?: number;
    workspace?: string;
  }>();
}

/** Build the standard filters object from global options. */
function globalFilters() {
  const g = globals();
  return { org: g.org, team: g.team, tag: g.tag, group: g.group };
}

program
  .name('gitradar')
  .description('Terminal-based TUI analytics for git contribution data')
  .version('0.1.0')
  .enablePositionalOptions();

// ── Global options ───────────────────────────────────────────────────────────

program
  .option('-c, --config <path>', 'Config file path')
  .option('-w, --weeks <n>', 'Weeks of history', parseInt)
  .option('-t, --team <name>', 'Filter to team')
  .option('--org <name>', 'Filter to organization')
  .option('--tag <tag>', 'Filter to tag')
  .option('--group <group>', 'Filter to repo group')
  .option('--demo', 'Use generated demo data')
  .option('--json', 'Output as JSON')
  .option('--force-scan', 'Full re-scan, ignore cursors')
  .option('--prune <days>', 'Remove records older than N days', parseInt)
  .option('--store-stats', 'Print data file stats and exit')
  .option('--reset', 'Delete data files and start fresh')
  .option('--staleness <min>', 'Override staleness minutes', parseInt)
  .option('--workspace <name>', 'Select workspace by name (skips prompt)');

// ── Top-level commands ───────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize gitradar config and data directories')
  .action(async () => {
    const { mkdir, writeFile, access } = await import('node:fs/promises');

    const dataDir = getDataDir();
    await mkdir(dataDir, { recursive: true });

    const configPath = getConfigPath();
    let configCreated = false;
    try {
      await access(configPath);
      console.log(`Config already exists: ${configPath}`);
    } catch {
      await writeFile(configPath, 'orgs: []\n', 'utf-8');
      configCreated = true;
      console.log(`Created config: ${configPath}`);
    }

    const reposPath = path.join(homedir(), '.agentx', 'repos.yml');
    let reposCreated = false;
    try {
      await access(reposPath);
      console.log(`Repos registry already exists: ${reposPath}`);
    } catch {
      const yaml = (await import('js-yaml')).default;
      await writeFile(reposPath, yaml.dump({ workspaces: {}, groups: {}, tags: {} }), 'utf-8');
      reposCreated = true;
      console.log(`Created repos registry: ${reposPath}`);
    }

    if (!configCreated && !reposCreated) {
      console.log('\nAlready initialized. Nothing to do.');
    } else {
      console.log('\nInitialized. Next steps:');
      console.log('  gitradar workspace create <name>');
      console.log('  gitradar repo add <path> --workspace <name>');
      console.log('  gitradar org add --name <org> --type core --team <team>');
      console.log('  gitradar scan --workspace <name>');
    }
  });

program
  .command('scan')
  .description('Scan repos and exit (no TUI)')
  .option('--workspace <name>', 'Select workspace by name')
  .option('--force-scan', 'Full re-scan, ignore cursors')
  .option('--staleness <min>', 'Override staleness minutes', parseInt)
  .option('-w, --weeks <n>', 'Weeks of history', parseInt)
  .action(async (cmdOpts: { workspace?: string; forceScan?: boolean; staleness?: number; weeks?: number }) => {
    const g = globals();
    await runMain({
      ...g,
      workspace: cmdOpts.workspace ?? g.workspace,
      forceScan: cmdOpts.forceScan ?? g.forceScan,
      staleness: cmdOpts.staleness ?? g.staleness,
      weeks: cmdOpts.weeks ?? g.weeks,
      scanOnly: true,
    });
  });

// ── gitradar workspace ───────────────────────────────────────────────────────

const workspace = program.command('workspace').description('Manage workspaces');

workspace
  .command('create <name>')
  .description('Create a new workspace')
  .option('--label <label>', 'Workspace label')
  .action(async (name: string, cmdOpts: { label?: string }) => {
    const { loadReposRegistry, saveReposRegistry } = await import('./config/repos-registry.js');

    const reposPath = path.join(homedir(), '.agentx', 'repos.yml');
    let registry = await loadReposRegistry(reposPath);
    if (!registry) {
      registry = { workspaces: {}, groups: {}, tags: {} };
    }

    if (registry.workspaces[name]) {
      console.log(`Workspace "${name}" already exists.`);
      return;
    }

    registry.workspaces[name] = { label: cmdOpts.label ?? name, repos: [] };
    await saveReposRegistry(reposPath, registry);
    console.log(`Created workspace "${name}" at ${reposPath}`);
    console.log(`\nNext: gitradar repo add <path> --workspace ${name} --group <group>`);
  });

workspace
  .command('list')
  .description('List all workspaces')
  .action(async () => {
    const gitRoot = await detectGitRoot();
    const registries = await loadAllRegistries(gitRoot ?? undefined);
    const workspaces = getAvailableWorkspaces(registries);

    if (workspaces.length === 0) {
      console.log('No workspaces found. Run "gitradar workspace create <name>" first.');
      return;
    }

    if (globals().json) {
      console.log(JSON.stringify(workspaces.map((w) => ({
        name: w.name,
        label: w.label,
        repos: w.repos.length,
        source: w.source.path,
      })), null, 2));
      return;
    }

    for (const w of workspaces) {
      console.log(`  ${w.name} (${w.repos.length} repos) — ${w.source.path}`);
    }
  });

// ── gitradar repo ────────────────────────────────────────────────────────────

const repo = program.command('repo').description('Manage repos in a workspace');

repo
  .command('list')
  .description('List repos in the current workspace')
  .option('--workspace <name>', 'Select workspace by name')
  .action(async (cmdOpts: { workspace?: string }) => {
    const { listRepos } = await import('./commands/manage-repos.js');
    await listRepos({ workspace: cmdOpts.workspace ?? globals().workspace, json: globals().json });
  });

repo
  .command('add <path>')
  .description('Discover and add repos from a directory')
  .option('--workspace <name>', 'Select workspace by name')
  .option('--group <name>', 'Group name for discovered repos', 'default')
  .option('--depth <n>', 'Directory scan depth (1-3)', parseInt)
  .action(async (dirPath: string, cmdOpts: { workspace?: string; group: string; depth?: number }) => {
    const { addRepos } = await import('./commands/manage-repos.js');
    await addRepos({ path: dirPath, group: cmdOpts.group, depth: cmdOpts.depth, workspace: cmdOpts.workspace ?? globals().workspace });
  });

repo
  .command('remove <name>')
  .description('Remove a repo from the current workspace')
  .option('--workspace <name>', 'Select workspace by name')
  .action(async (name: string, cmdOpts: { workspace?: string }) => {
    const { removeRepo } = await import('./commands/manage-repos.js');
    await removeRepo({ name, workspace: cmdOpts.workspace ?? globals().workspace });
  });

// ── gitradar org ─────────────────────────────────────────────────────────────

const org = program.command('org').description('Manage organizations and teams');

org
  .command('list')
  .description('List configured organizations and teams')
  .action(async () => {
    const { listOrgs } = await import('./commands/list-orgs.js');
    await listOrgs({ config: globals().config, json: globals().json });
  });

org
  .command('add')
  .description('Add a new organization with a team')
  .requiredOption('--name <name>', 'Organization name')
  .requiredOption('--type <type>', 'Type: core or consultant')
  .option('--identifier <prefix>', 'Identifier prefix for auto-matching')
  .requiredOption('--team <name>', 'Initial team name')
  .option('--tag <tag>', 'Team tag (default: "default")')
  .action(async (cmdOpts: { name: string; type: string; identifier?: string; team: string; tag?: string }) => {
    if (cmdOpts.type !== 'core' && cmdOpts.type !== 'consultant') {
      console.error('--type must be "core" or "consultant"');
      process.exitCode = 1;
      return;
    }
    const { addOrg } = await import('./commands/add-org.js');
    await addOrg({ ...cmdOpts, type: cmdOpts.type, config: globals().config });
  });

org
  .command('add-team')
  .description('Add a team to an existing organization')
  .requiredOption('--name <org>', 'Organization name')
  .requiredOption('--team <name>', 'Team name')
  .option('--tag <tag>', 'Team tag (default: "default")')
  .action(async (cmdOpts: { name: string; team: string; tag?: string }) => {
    const { addTeamToOrg } = await import('./commands/add-org.js');
    await addTeamToOrg({ org: cmdOpts.name, team: cmdOpts.team, tag: cmdOpts.tag, config: globals().config });
  });

// ── gitradar author ──────────────────────────────────────────────────────────

const author = program.command('author').description('Manage discovered authors');

author
  .command('list')
  .description('List discovered authors from git history')
  .option('--unassigned', 'Show only unassigned authors')
  .option('--assigned', 'Show only assigned authors')
  .action(async (cmdOpts: { unassigned?: boolean; assigned?: boolean }) => {
    const { listAuthors } = await import('./commands/list-authors.js');
    await listAuthors({ ...cmdOpts, json: globals().json });
  });

author
  .command('assign <email>')
  .description('Assign an author to an org and team')
  .requiredOption('--org <name>', 'Organization name')
  .requiredOption('--team <name>', 'Team name')
  .action(async (email: string, cmdOpts: { org: string; team: string }) => {
    const { assignAuthorCmd } = await import('./commands/assign-author.js');
    await assignAuthorCmd({ email, org: cmdOpts.org, team: cmdOpts.team, config: globals().config });
  });

author
  .command('bulk-assign')
  .description('Bulk-assign authors by name/email prefix')
  .requiredOption('--prefix <prefix>', 'Prefix to match against name or email')
  .requiredOption('--org <name>', 'Organization name')
  .requiredOption('--team <name>', 'Team name')
  .action(async (cmdOpts: { prefix: string; org: string; team: string }) => {
    const { bulkAssignCmd } = await import('./commands/assign-author.js');
    await bulkAssignCmd({ prefix: cmdOpts.prefix, org: cmdOpts.org, team: cmdOpts.team, config: globals().config });
  });

// ── gitradar view ────────────────────────────────────────────────────────────

const view = program.command('view').description('View analytics reports');

view
  .command('contributions')
  .description('Show contribution data by member, team, org, or repo')
  .option('-w, --weeks <n>', 'Weeks of history', parseInt)
  .option('--by <dimension>', 'Group by: member, team, org, repo', 'member')
  .option('--pivot <granularity>', 'Pivot by time: week, month, quarter, year')
  .action(async (cmdOpts: { weeks?: number; by?: string; pivot?: string }) => {
    const g = globals();
    const { contributions } = await import('./commands/contributions.js');
    await contributions({
      weeks: cmdOpts.weeks ?? g.weeks,
      groupBy: (cmdOpts.by as 'member' | 'team' | 'org' | 'repo') ?? 'member',
      pivot: cmdOpts.pivot as 'week' | 'month' | 'quarter' | 'year' | undefined,
      json: g.json,
      filters: globalFilters(),
    });
  });

view
  .command('leaderboard')
  .description('Show top performers')
  .option('-w, --weeks <n>', 'Weeks of history', parseInt)
  .option('--top <n>', 'Number of entries per category', parseInt)
  .action(async (cmdOpts: { weeks?: number; top?: number }) => {
    const g = globals();
    const { leaderboard } = await import('./commands/leaderboard.js');
    await leaderboard({
      weeks: cmdOpts.weeks ?? g.weeks ?? 4,
      top: cmdOpts.top,
      json: g.json,
      filters: globalFilters(),
    });
  });

view
  .command('repo-activity')
  .description('Show repo activity summary')
  .option('-w, --weeks <n>', 'Weeks of history', parseInt)
  .action(async (cmdOpts: { weeks?: number }) => {
    const g = globals();
    const { repoActivity } = await import('./commands/repo-activity.js');
    await repoActivity({
      weeks: cmdOpts.weeks ?? g.weeks ?? 8,
      json: g.json,
      filters: globalFilters(),
    });
  });

view
  .command('trends')
  .description('Jump directly to trends view')
  .action(async () => {
    await runMain({ ...globals(), initialView: 'trends' });
  });

// ── gitradar data ────────────────────────────────────────────────────────────

const data = program.command('data').description('Export and import data');

data
  .command('export')
  .description('Export workspace as portable YAML (no local paths)')
  .action(async () => {
    const { exportWorkspace } = await import('./commands/export.js');
    await exportWorkspace();
  });

data
  .command('export-csv')
  .description('Export contribution data as CSV')
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .action(async (cmdOpts: { output?: string }) => {
    const { exportData } = await import('./commands/export-data.js');
    await exportData({ output: cmdOpts.output, filters: globalFilters() });
  });

data
  .command('import <file>')
  .description('Import workspace repos from exported YAML file')
  .action(async (file: string) => {
    const { importWorkspace } = await import('./commands/import.js');
    await importWorkspace(file);
  });

// ── gitradar enrich ──────────────────────────────────────────────────────

program
  .command('enrich')
  .description('Enrich data with GitHub PR metrics and churn analysis')
  .option('-w, --weeks <n>', 'Weeks to enrich (default: 4)', parseInt)
  .option('--repo <name>', 'Enrich only this repo')
  .option('--force', 'Re-enrich even if data exists')
  .option('--skip-churn', 'Skip churn rate calculation')
  .action(async (cmdOpts: { weeks?: number; repo?: string; force?: boolean; skipChurn?: boolean }) => {
    const { enrich: enrichCmd } = await import('./commands/enrich.js');
    await enrichCmd({
      weeks: cmdOpts.weeks,
      repo: cmdOpts.repo,
      force: cmdOpts.force,
      skipChurn: cmdOpts.skipChurn,
      config: globals().config,
    });
  });

// ── Default action (no subcommand → TUI) ────────────────────────────────────

program.action(async () => {
  await runMain(globals());
});

// ── Main logic ───────────────────────────────────────────────────────────────

interface RunOptions {
  config?: string;
  weeks?: number;
  team?: string;
  org?: string;
  tag?: string;
  group?: string;
  demo?: boolean;
  json?: boolean;
  forceScan?: boolean;
  prune?: number;
  storeStats?: boolean;
  reset?: boolean;
  staleness?: number;
  workspace?: string;
  scanOnly?: boolean;
  initialView?: 'dashboard' | 'trends';
}

async function runMain(opts: RunOptions): Promise<void> {
  // ── Handle --reset early ─────────────────────────────────────────────────
  if (opts.reset) {
    try {
      await rm(getCommitsPath(), { force: true });
      await rm(getScanStatePath(), { force: true });
      await rm(getAuthorRegistryPath(), { force: true });
      await rm(getEnrichmentsPath(), { force: true });
      console.log('Data files deleted. Starting fresh.');
    } catch {
      console.log('No data files to delete.');
    }
    return;
  }

  // ── Handle --store-stats early ───────────────────────────────────────────
  if (opts.storeStats) {
    const commitsDataForStats = await loadCommitsData();
    const stats = getStoreStats(commitsDataForStats);
    console.log(`Store stats:`);
    console.log(`  Records:      ${stats.recordCount}`);
    console.log(`  Organizations: ${stats.orgCount}`);
    console.log(`  Teams:         ${stats.teamCount}`);
    console.log(`  Oldest week:   ${stats.oldestWeek ?? 'n/a'}`);
    console.log(`  Newest week:   ${stats.newestWeek ?? 'n/a'}`);
    return;
  }

  // ── Load config (or generate demo) ───────────────────────────────────────

  let config: Config;
  let records: UserWeekRepoRecord[];
  let liveScanState: ScanState | undefined;
  let authorRegistry: AuthorRegistry | undefined;
  let commitsData: { version: 1; lastUpdated: string; records: UserWeekRepoRecord[] } | undefined;
  let selectedWorkspace: LoadedWorkspace | undefined;
  let resolvedConfigPath: string | undefined;

  if (opts.demo) {
    const demoData = generateDemoData(opts.weeks ?? 12);
    config = demoData.config;
    records = demoData.records;
    console.log(
      `Demo mode: ${records.length} records generated ` +
        `(${config.orgs.length} orgs, ${config.orgs.reduce((n, o) => n + o.teams.length, 0)} teams)`,
    );
  } else {
    // ── Load config.yml for orgs, settings, and workspace preference ─────
    let configOrgs: Config['orgs'] = [];
    let configSettings: Config['settings'] = { weeks_back: 12, staleness_minutes: 60, trend_threshold: 0.10 };
    let configWorkspace: string | undefined;
    try {
      const baseConfig = await loadConfig(opts.config);
      configOrgs = baseConfig.orgs;
      configSettings = baseConfig.settings;
      configWorkspace = baseConfig.workspace;
      resolvedConfigPath = opts.config;
    } catch {
      // config.yml missing or invalid — proceed with defaults
    }

    // ── Discover workspaces ───────────────────────────────────────────────
    const gitRoot = await detectGitRoot();
    const registries = await loadAllRegistries(gitRoot ?? undefined);
    const workspaces = getAvailableWorkspaces(registries);

    if (workspaces.length === 0) {
      const registryPath = path.join(homedir(), '.agentx', 'repos.yml');
      console.log('No workspaces found.');
      console.log(`Create one at ${registryPath}? (y/n) `);

      try {
        const answer = await readKey();
        if (answer.name !== 'y') {
          console.log('Cancelled.');
          return;
        }
      } catch {
        return; // Ctrl+C
      }

      const { workspace: ws } = await createWorkspace(registryPath, 'default');
      workspaces.push(ws);
      console.log(`Created workspace "default" at ${registryPath}`);
      console.log('Use D (Add repos) in the Manage tab to add repositories.\n');
    }

    // Workspace precedence: CLI --workspace > config.yml workspace > prompt
    const workspaceName = opts.workspace ?? configWorkspace;
    const selected = await selectWorkspace(workspaces, workspaceName);
    if (!selected) {
      console.error('No workspace selected.');
      process.exitCode = 1;
      return;
    }

    selectedWorkspace = selected;

    console.log(
      `Workspace: ${selected.name} (${selected.repos.length} repos) from ${selected.source.path}`,
    );

    config = buildConfigFromWorkspace(selected, configOrgs, configSettings);

    // Override weeks_back from CLI if provided
    if (opts.weeks !== undefined) {
      config = {
        ...config,
        settings: { ...config.settings, weeks_back: opts.weeks },
      };
    }

    // Load existing store data
    const scanState = await loadScanState();
    commitsData = await loadCommitsData();
    authorRegistry = await loadAuthorRegistry();

    // Print store summary
    const stats = getStoreStats(commitsData);
    const lastScanAgo = getLastScanAgo(scanState);
    const authorCount = Object.keys(authorRegistry.authors).length;
    const unassignedCount = Object.values(authorRegistry.authors).filter((a) => !a.org).length;
    console.log(
      `Store: ${stats.recordCount} records \u00b7 ` +
        `${stats.orgCount} orgs \u00b7 ` +
        `${stats.teamCount} teams \u00b7 ` +
        `${authorCount} authors` +
        (unassignedCount > 0 ? ` (${unassignedCount} unassigned)` : '') +
        ` \u00b7 last scan: ${lastScanAgo}`,
    );

    // Handle --prune
    if (opts.prune !== undefined) {
      const weeksBack = Math.ceil(opts.prune / 7);
      const pruned = pruneOldRecords(commitsData.records, weeksBack);
      const removed = commitsData.records.length - pruned.length;
      await saveCommitsData({ ...commitsData, records: pruned });
      console.log(`Pruned ${removed} records older than ${opts.prune} days.`);

      if (opts.scanOnly) return;
    }

    // Scan repos — flush records to disk after each repo to bound memory
    console.log('');
    let liveRecords = commitsData.records;

    liveScanState = scanState;

    const result = await scanAllRepos(config, scanState, {
      forceScan: opts.forceScan,
      stalenessMinutes: opts.staleness,
      chunkMonths: 3,
      authorRegistry,
      onRepoScanned: async (repoRecords) => {
        liveRecords = mergeRecords(liveRecords, repoRecords);
        await saveCommitsData({ ...commitsData!, records: liveRecords });
      },
      onScanStateUpdated: async (state) => {
        liveScanState = state;
        await saveScanState(state);
      },
      onAuthorsDiscovered: async (authors) => {
        authorRegistry = mergeDiscoveredAuthors(
          authorRegistry!,
          authors.map((a) => ({
            email: a.email,
            name: a.name,
            repoName: a.repoName,
            commitCount: a.commitCount,
            date: a.lastDate,
          })),
        );
        await saveAuthorRegistry(authorRegistry!);
      },
    });

    const newAuthors = Object.values(authorRegistry.authors).filter((a) => !a.org).length;
    console.log(
      `\nScan complete: ${result.stats.reposScanned} scanned, ` +
        `${result.stats.reposSkipped} fresh, ` +
        `${result.stats.reposMissing} missing \u2192 ` +
        `+${result.stats.totalRecords} new records` +
        (newAuthors > 0 ? ` \u00b7 ${newAuthors} unassigned authors` : ''),
    );

    records = liveRecords;

    // If scan-only mode, exit now
    if (opts.scanOnly) return;
  }

  // ── Apply CLI filters ────────────────────────────────────────────────────

  const filters: {
    org?: string;
    team?: string;
    tag?: string;
    group?: string;
  } = {};
  if (opts.org) filters.org = opts.org;
  if (opts.team) filters.team = opts.team;
  if (opts.tag) filters.tag = opts.tag;
  if (opts.group) filters.group = opts.group;

  if (Object.keys(filters).length > 0) {
    records = filterRecords(records, filters);
  }

  // ── Handle --json ────────────────────────────────────────────────────────

  if (opts.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  // ── Reattribute records to reflect latest author assignments ─────────────
  records = reattributeRecords(records, config, authorRegistry);

  // ── Build ViewContext and launch navigator ───────────────────────────────

  const ctx: ViewContext = {
    config,
    records,
    currentWeek: getCurrentWeek(),
    scanState: liveScanState,
    authorRegistry,
    onScanRepo: async (repoName: string) => {
      const repoEntry = ctx.config.repos.find(
        (r) => (r.name ?? r.path.split('/').pop() ?? r.path) === repoName,
      );
      if (!repoEntry) throw new Error(`Repo not found: ${repoName}`);

      const singleConfig = { ...ctx.config, repos: [repoEntry] };
      const currentRegistry = ctx.authorRegistry ?? { version: 1 as const, authors: {} };
      if (!commitsData) commitsData = await loadCommitsData();

      const freshScanState: ScanState = {
        version: 1,
        repos: { ...(ctx.scanState ?? { version: 1 as const, repos: {} }).repos },
      };
      delete freshScanState.repos[repoName];

      let currentRecords = ctx.records.filter((r) => r.repo !== repoName);
      const storedRecords = commitsData.records.filter((r) => r.repo !== repoName);
      const storedCommitsData = { ...commitsData, records: storedRecords };

      const scanResult = await scanAllRepos(singleConfig, freshScanState, {
        forceScan: true,
        chunkMonths: 3,
        authorRegistry: currentRegistry,
        onRepoScanned: async (repoRecords) => {
          currentRecords = mergeRecords(currentRecords, repoRecords);
          await saveCommitsData({ ...storedCommitsData, records: currentRecords });
        },
        onScanStateUpdated: saveScanState,
        onAuthorsDiscovered: async (authors) => {
          ctx.authorRegistry = mergeDiscoveredAuthors(
            ctx.authorRegistry ?? { version: 1 as const, authors: {} },
            authors.map((a) => ({
              email: a.email,
              name: a.name,
              repoName: a.repoName,
              commitCount: a.commitCount,
              date: a.lastDate,
            })),
          );
          await saveAuthorRegistry(ctx.authorRegistry);
        },
      });

      ctx.records = currentRecords;
      ctx.scanState = scanResult.updatedScanState;
      commitsData = { ...commitsData!, records: currentRecords };
      return { records: ctx.records, scanState: ctx.scanState };
    },
    onScanDir: !selectedWorkspace ? undefined : async (dirPath: string, group: string, depth: number) => {
      const discovered = await scanDirectory(dirPath, depth);
      if (discovered.length === 0) return 0;

      const added = addReposToWorkspace(
        selectedWorkspace!,
        discovered.map((r) => ({ name: r.name, path: r.path, group })),
      );

      if (added > 0) {
        await saveReposRegistry(
          selectedWorkspace!.source.path,
          selectedWorkspace!.source.registry,
        );
        ctx.config = buildConfigFromWorkspace(
          selectedWorkspace!,
          config.orgs,
          config.settings,
        );
      }

      return added;
    },
    onRemoveRepo: !selectedWorkspace ? undefined : async (repoName: string) => {
      removeRepoFromWorkspace(selectedWorkspace!, repoName);
      await saveReposRegistry(
        selectedWorkspace!.source.path,
        selectedWorkspace!.source.registry,
      );
    },
    onAddOrg: async (_org: Org) => {
      await saveConfig(resolvedConfigPath, { orgs: ctx.config.orgs });
    },
    onSaveAuthorRegistry: async (registry) => {
      await saveAuthorRegistry(registry);
    },
  };

  const initial =
    opts.initialView === 'trends'
      ? trendsView
      : dashboardView;

  process.on('SIGINT', () => {
    console.log('\n');
    process.exit(0);
  });

  await runNavigator(initial, ctx);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLastScanAgo(scanState: {
  repos: Record<string, { lastScanDate: string }>;
}): string {
  let latest = 0;
  for (const r of Object.values(scanState.repos)) {
    const t = new Date(r.lastScanDate).getTime();
    if (t > latest) latest = t;
  }
  if (latest === 0) return 'never';
  const minutes = Math.round((Date.now() - latest) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function buildConfigFromWorkspace(
  ws: LoadedWorkspace,
  configOrgs: Config['orgs'],
  configSettings: Config['settings'],
): Config {
  return {
    repos: ws.repos.map((r) => ({
      path: r.path ?? '',
      name: r.name,
      group: r.group,
    })),
    orgs: configOrgs,
    groups: ws.source.registry.groups,
    tags: ws.source.registry.tags,
    settings: configSettings,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
