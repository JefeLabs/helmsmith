import { Command } from 'commander';
import path from 'node:path';
import { homedir } from 'node:os';
import { detectGitRoot } from './config/git-root.js';
import {
  loadAllRegistries,
  getAvailableWorkspaces,
} from './config/repos-registry.js';
import { getConfigPath, getDataDir } from './store/paths.js';
import { runMain } from './commands/run-main.js';

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
  .option('--skip-enrich', 'Skip enrichment after scan')
  .option('--watch [interval]', 'Re-scan periodically (interval in minutes, default: 30)')
  .action(async (cmdOpts: { workspace?: string; forceScan?: boolean; staleness?: number; weeks?: number; skipEnrich?: boolean; watch?: string | boolean }) => {
    const g = globals();
    const runOpts = {
      ...g,
      workspace: cmdOpts.workspace ?? g.workspace,
      forceScan: cmdOpts.forceScan ?? g.forceScan,
      staleness: cmdOpts.staleness ?? g.staleness,
      weeks: cmdOpts.weeks ?? g.weeks,
      skipEnrich: cmdOpts.skipEnrich,
      scanOnly: true,
    };

    if (cmdOpts.watch !== undefined) {
      const intervalMin = typeof cmdOpts.watch === 'string' ? parseInt(cmdOpts.watch, 10) : 30;
      if (isNaN(intervalMin) || intervalMin < 1) {
        console.error('Error: --watch interval must be a positive integer (minutes).');
        process.exitCode = 1;
        return;
      }
      const intervalMs = intervalMin * 60 * 1000;
      console.log(`Background scan mode: scanning every ${Math.round(intervalMs / 60000)} minutes. Press Ctrl+C to stop.`);

      const scan = async () => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n[${timestamp}] Scanning...`);
        try {
          await runMain(runOpts);
        } catch (err) {
          console.error(`  Scan error: ${err instanceof Error ? err.message : err}`);
        }
      };

      await scan();
      const loop = async () => {
        while (true) {
          await new Promise(r => setTimeout(r, intervalMs));
          await scan();
        }
      };
      loop().catch(err => {
        console.error('Watch loop crashed:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
      });
    } else {
      await runMain(runOpts);
    }
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
  .option('--segment <tier>', 'Filter to segment: high, middle, low')
  .action(async (cmdOpts: { weeks?: number; by?: string; pivot?: string; segment?: string }) => {
    const g = globals();
    const { contributions } = await import('./commands/contributions.js');
    await contributions({
      weeks: cmdOpts.weeks ?? g.weeks,
      groupBy: (cmdOpts.by as 'member' | 'team' | 'org' | 'repo') ?? 'member',
      pivot: cmdOpts.pivot as 'week' | 'month' | 'quarter' | 'year' | undefined,
      segment: cmdOpts.segment as 'high' | 'middle' | 'low' | undefined,
      json: g.json,
      filters: globalFilters(),
    });
  });

view
  .command('leaderboard')
  .description('Show top performers')
  .option('-w, --weeks <n>', 'Weeks of history', parseInt)
  .option('--top <n>', 'Number of entries per category', parseInt)
  .option('--segment <tier>', 'Filter to segment: high, middle, low')
  .action(async (cmdOpts: { weeks?: number; top?: number; segment?: string }) => {
    const g = globals();
    const { leaderboard } = await import('./commands/leaderboard.js');
    await leaderboard({
      weeks: cmdOpts.weeks ?? g.weeks ?? 4,
      top: cmdOpts.top,
      segment: cmdOpts.segment as 'high' | 'middle' | 'low' | undefined,
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
  .option('--deep-churn', 'Use full per-file churn analysis (slower, more precise)')
  .option('--concurrency <n>', 'Max concurrent GitHub API requests (default: 5)', parseInt)
  .option('--skip-cache', 'Bypass local GitHub API response cache (force fresh fetch)')
  .option('--workspace <name>', 'Workspace to use for repo paths')
  .action(async (cmdOpts: { weeks?: number; repo?: string; force?: boolean; skipChurn?: boolean; deepChurn?: boolean; concurrency?: number; skipCache?: boolean; workspace?: string }) => {
    const { enrich: enrichCmd } = await import('./commands/enrich.js');
    await enrichCmd({
      weeks: cmdOpts.weeks,
      repo: cmdOpts.repo,
      force: cmdOpts.force,
      skipChurn: cmdOpts.skipChurn,
      deepChurn: cmdOpts.deepChurn,
      concurrency: cmdOpts.concurrency,
      skipCache: cmdOpts.skipCache,
      config: globals().config,
      workspace: cmdOpts.workspace,
    });
  });

// ── Default action (no subcommand → TUI) ────────────────────────────────────

program.action(async () => {
  await runMain(globals());
});

// ── Entry point ──────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
