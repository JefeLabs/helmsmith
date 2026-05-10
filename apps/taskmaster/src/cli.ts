import { createCli } from '@ecruz165/cli-kit';
import chalk from 'chalk';
import {
  CLI_BIN_NAME,
  CLI_DESCRIPTION,
  CLI_VERSION,
  APP_CONFIG_DIR_DISPLAY,
  APP_REPO_CONFIG_DIR_DISPLAY,
} from './config/branding.js';
import { bootstrapHome, bootstrapRepoHome } from './utils/home.js';
import {
  createProject,
  switchProject,
} from './utils/projects.js';
import { resolveProjectOrThrow } from './config/resolver.js';
import { loadProjectConfig, writeProjectConfig } from './config/loader.js';
import { readTasks, writeTasks } from './formats/tasks-store.js';
import { detectGitRoot } from './utils/git.js';
import { ensureGitignoreEntry } from './utils/gitignore.js';
import type { ProjectLocation } from './utils/location.js';
import { resolveStates, findTaskById, getDefaultStatus } from './config/state-engine.js';
import { setProjectPath, renderToTerminal, renderToMarkdown } from './generator/index.js';
import type { ReportFormat } from './reports/types.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getNextId } from './parser/index.js';
import { writeDefaults } from './utils/defaults.js';
import type { InitWizardResult } from './prompts/init-wizard.js';
import type { ComplexityReportContext } from './generator/types.js';
import {
  resolveActiveAuth,
  AI_PROVIDERS,
} from './auth/index.js';
import type { AIProviderName } from './auth/index.js';
import { confirmExpand, confirmBulkOperation, confirmRemove } from './prompts/confirmations.js';
import { getEffectiveVocabulary } from './skills/index.js';
import { executeAdd, type AddCommandOpts } from './commands/add.js';
import { executeRemove } from './commands/remove.js';
import { executeSetStatus } from './commands/set-status.js';
import { executeQAFail, executeQAFailBatch, type QAFailOpts, type QAFailBatchEntry } from './commands/qa-fail.js';
import { executeQAClear, executeQAClearBatch, type QAClearBatchEntry } from './commands/qa-clear.js';
import { executeList } from './commands/list.js';
import { executeShow } from './commands/show.js';
import { executeNext } from './commands/next.js';
import { executeGenerate } from './commands/generate.js';
import { executeSync } from './commands/sync.js';
import { executeScore } from './commands/score.js';
import { validateExpandable, executeExpand, findExpandCandidates, executeExpandAll } from './commands/expand.js';
import { executeValidate } from './commands/validate.js';
import { executeReport } from './commands/report.js';
import { executeConfigGet, executeConfigSet, executeConfigEdit } from './commands/config-cmd.js';
import { executeAuthLogin, executeAuthStatus, executeAuthSwitch, executeAuthLogout } from './commands/auth.js';
import { executeProjectsList, executeProjectsCreate, executeProjectsSwitch, executeProjectsRemove } from './commands/projects.js';
import { executeBlueprintApply, executeBlueprintCheck } from './commands/blueprint.js';
import { executeReady } from './commands/ready.js';
import { executeScan } from './commands/scan.js';
import { executeParse } from './commands/parse.js';
import { executeInit } from './commands/init.js';
import { registerRebrand } from './commands/rebrand.js';
import { runConnect } from './commands/connect.js';
import yaml from 'js-yaml';
import Table from 'cli-table3';

// No `auth` wired — taskmaster resolves auth per-project via
// `resolveActiveAuth(config.ai.provider)` (multi-provider with PKCE
// state for Anthropic Claude.ai subscription, broader than cli-kit's
// AuthProvider contract). cli-kit still provides the bootstrap.
const { program } = createCli({
  name: CLI_BIN_NAME,
  version: CLI_VERSION,
  description: CLI_DESCRIPTION,
});

program.option('--project <name>', 'Target a specific project without switching active');

// --- Placeholder handler ---
function notImplemented(cmdName: string) {
  return () => {
    console.log(chalk.yellow(`Command "${cmdName}" is not yet implemented.`));
  };
}

// --- init ---
program
  .command('init')
  .description('Interactive project setup with smart defaults')
  .option('--style <style>', 'Project style (agile-full, story-driven, task-only, flat)')
  .option('--name <name>', 'Project name')
  .option('--model <model>', 'AI model (e.g., gpt-4.1, gpt-4o, claude-sonnet-4.5)')
  .option('--repo', 'Store project data in the current repository')
  .option('--no-interactive', 'Skip interactive prompts')
  .action(async (opts: { style?: string; name?: string; model?: string; repo?: boolean; interactive?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();

      const { wizardResult, isSwitchTo } = await executeInit(opts, gitRoot);

      // Handle switch-to-existing
      if (isSwitchTo) {
        await switchProject(wizardResult.switchTo!, wizardResult.switchToLocation!, gitRoot);
        console.log(chalk.green(`Switched active project to "${wizardResult.switchTo}".`));
        return;
      }

      // Create project with wizard config
      const projectConfig = {
        style: wizardResult.style,
        states: { preset: wizardResult.statePreset, enforce_transitions: false },
        skills: { vocabulary: wizardResult.skills, auto_infer: true },
        ai: { provider: wizardResult.provider ?? 'copilot', model: wizardResult.model },
        thresholds: wizardResult.thresholds,
      };

      if (wizardResult.location === 'repo' && gitRoot) {
        await bootstrapRepoHome(gitRoot);
      }

      await createProject(wizardResult.name, wizardResult.location, gitRoot, wizardResult.description, projectConfig);

      if (wizardResult.location === 'repo' && wizardResult.gitignore && gitRoot) {
        await ensureGitignoreEntry(gitRoot);
      }

      await writeDefaults({
        provider: wizardResult.provider,
        model: wizardResult.model,
        style: wizardResult.style,
        statusPreset: wizardResult.statePreset,
        skills: wizardResult.skills,
        thresholds: wizardResult.thresholds,
      });

      // Install agent instruction files if requested
      let installedInstructions: string[] = [];
      if (wizardResult.aiTooling && wizardResult.instructionIds?.length) {
        const { installContext } = await import('./context/index.js');
        const repoRoot = gitRoot ?? process.cwd();
        const result = await installContext(repoRoot, wizardResult.instructionIds, wizardResult.aiTooling);
        installedInstructions = result.files;
      }

      const locationLabel = wizardResult.location === 'repo' ? ' [repo]' : ' [home]';
      console.log(chalk.green(`\nProject "${wizardResult.name}"${locationLabel} created and set as active.`));
      console.log(chalk.dim(`  Style: ${wizardResult.style} | Status preset: ${wizardResult.statePreset}`));
      console.log(chalk.dim(`  Model: ${wizardResult.model}`));
      console.log(chalk.dim(`  Skills: ${wizardResult.skills.join(', ')}`));
      console.log(chalk.dim(`  Thresholds: expand=${wizardResult.thresholds.expand}, flag=${wizardResult.thresholds.flag}`));
      if (wizardResult.location === 'repo' && wizardResult.gitignore) {
        console.log(chalk.dim(`  .agentx/ added to .gitignore`));
      }
      if (installedInstructions.length > 0) {
        console.log(chalk.dim(`  Agent instructions (${wizardResult.aiTooling}):`));
        for (const f of installedInstructions) {
          console.log(chalk.dim(`    ${f}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- scan ---
program
  .command('scan [path]')
  .description('Scan repository and build capabilities model (components, layers, symbols)')
  .action(async (pathArg?: string) => {
    try {
      const gitRoot = await detectGitRoot();
      const rootPath = pathArg ? resolve(pathArg) : (gitRoot ?? process.cwd());

      if (!existsSync(rootPath)) {
        console.error(chalk.red(`Error: Path "${rootPath}" does not exist.`));
        process.exitCode = 1;
        return;
      }

      console.log(chalk.bold(`Scanning ${rootPath}...\n`));

      const repoHome = gitRoot
        ? (await import('./utils/git.js')).getRepoTaskmasterHome(gitRoot)
        : null;

      const result = await executeScan(rootPath, repoHome);

      if (repoHome) {
        console.log(chalk.dim(`\n  Indexes persisted to ${repoHome}`));
      } else {
        console.log(chalk.yellow('\n  Not inside a git repository — indexes not persisted.'));
      }

      console.log(chalk.green('\nScan complete:'));
      console.log(chalk.dim(`  Files: ${result.totalFiles}`));
      console.log(chalk.dim(`  Directories: ${result.totalDirectories}`));
      console.log(chalk.dim(`  Components: ${result.componentCount}`));
      console.log(chalk.dim(`  Symbols: ${result.symbolCount}`));
      console.log(chalk.dim(`  Layers: ${result.layers.join(', ') || 'none'}`));
      if (result.entryPointCount > 0) {
        console.log(chalk.dim(`  Entry points: ${result.entryPointCount} detected [${result.entryPointCategories.join(', ')}]`));
        console.log(chalk.dim(`  Coverage: ${result.coveragePercent}%`));
      }
      if (result.detectedPatterns.length > 0) {
        console.log(chalk.dim(`  Patterns: ${result.detectedPatterns.join(', ')}`));
      }
      for (const w of result.warnings) {
        console.log(chalk.yellow(`  Warning: ${w}`));
      }
      if (result.blueprintDetections.length > 0) {
        console.log(chalk.bold('\n  Detected archetypes:'));
        for (const d of result.blueprintDetections) {
          const pct = Math.round(d.confidence * 100);
          console.log(chalk.dim(`    ${d.blueprintId} (${pct}%) — ${d.matchedSignals.join(', ')}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- parse ---
program
  .command('parse <file>')
  .description('Parse an implementation plan and generate tasks (AI-powered)')
  .option('--num-tasks <n>', 'Target number of tasks')
  .option('--style <style>', 'Project style override')
  .option('--append', 'Append to existing project tasks')
  .option('--force', 'Overwrite existing tasks without --append')
  .option('--no-ai', 'Skip AI parsing, use structural parser only')
  .option('--no-scan', 'Skip codebase scanning (only use PRD document)')
  .action(async (file: string, opts: { numTasks?: string; style?: string; append?: boolean; force?: boolean; ai?: boolean; scan?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);

      // Read input file
      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        console.error(chalk.red(`Error: File "${file}" not found.`));
        process.exitCode = 1;
        return;
      }
      const content = await readFile(filePath, 'utf-8');
      if (content.trim() === '') {
        console.error(chalk.red('Error: File is empty, nothing to parse.'));
        process.exitCode = 1;
        return;
      }

      // Overwrite protection
      const existingTasks = await readTasks(resolved.projectDir);
      if (existingTasks.length > 0 && !opts.append && !opts.force) {
        console.error(
          chalk.red(
            `Project already has ${existingTasks.length} task(s). ` +
              'Use --append to add to existing tasks, or --force to overwrite.',
          ),
        );
        process.exitCode = 1;
        return;
      }

      const result = await executeParse(
        content,
        file,
        existingTasks,
        config,
        opts,
        (msg) => console.log(chalk.dim(`  ${msg}`)),
      );

      await writeTasks(resolved.projectDir, result.finalTasks);

      // Persist analysis.json (architecture pipeline only)
      if (result.analysisJson) {
        const { writeFile } = await import('node:fs/promises');
        const analysisPath = resolve(resolved.projectDir, 'analysis.json');
        await writeFile(analysisPath, JSON.stringify(result.analysisJson, null, 2) + '\n');
        console.log(chalk.dim(`  Architecture analysis saved to analysis.json`));
      }

      // Summary output
      console.log(chalk.green(`Parsed ${result.topLevel} top-level task(s) (${result.total} total) from ${file}`));
      const methodLabel = result.parseMethod === 'ai-architecture'
        ? `AI architecture pipeline (${config.ai.provider})`
        : result.parseMethod === 'ai'
          ? `AI single-shot (${config.ai.provider})`
          : 'structural';
      console.log(chalk.dim(`  Parse method: ${methodLabel}`));
      if (result.skillSummary) {
        console.log(chalk.dim(`  ${result.skillSummary}`));
      }
      if (opts.append && existingTasks.length > 0) {
        console.log(chalk.dim(`  Existing tasks: ${existingTasks.length} (unchanged)`));
        console.log(chalk.dim(`  New tasks appended: ${result.topLevel}`));
      }
      for (const w of result.warnings) {
        console.log(chalk.yellow(`  Warning: ${w}`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- list ---
program
  .command('list')
  .description('List all tasks with status and complexity')
  .option('--status <status>', 'Filter by status')
  .option('--type <type>', 'Filter by type')
  .option('--category <cat>', 'Filter by category (open|active|closed)')
  .option('--skills <skills>', 'Filter by required skills (comma-separated, OR logic)')
  .option('--compact', 'Compact output')
  .option('--format <fmt>', 'Output format (json|md|table)')
  .action(async (opts: { status?: string; type?: string; category?: string; skills?: string; compact?: boolean; format?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const tasks = await readTasks(resolved.projectDir);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found. Run a parse command to generate tasks.'));
        return;
      }

      const result = executeList(tasks, opts);

      if (result.tasks.length === 0 && opts.skills) {
        console.log(chalk.yellow(`No tasks found matching skills: ${opts.skills}`));
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(result.tasks, null, 2));
        return;
      }

      setProjectPath(resolved.projectDir);
      const output = renderToTerminal('task-list', { tasks: result.tasks, filters: result.filters });
      console.log(output);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- show ---
program
  .command('show <id>')
  .description('Show full details of a specific task')
  .option('--with-children', 'Include children in output')
  .option('--format <fmt>', 'Output format (json|md|table)')
  .action(async (id: string, opts: { withChildren?: boolean; format?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const tasks = await readTasks(resolved.projectDir);

      const result = executeShow(tasks, id);

      if (opts.format === 'json') {
        console.log(JSON.stringify(result.task, null, 2));
        return;
      }

      setProjectPath(resolved.projectDir);
      const output = renderToTerminal('task-detail', { task: result.task, withChildren: opts.withChildren });
      console.log(output);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- score ---
program
  .command('score')
  .description('Run complexity scoring on unscored tasks')
  .option('--recalculate', 'Recalculate all scores (alias for --all)')
  .option('--threshold <n>', 'Flag tasks above this complexity threshold')
  .option('--all', 'Score all tasks, not just unscored')
  .option('--heuristic-only', 'Force heuristic scoring even when AI is available')
  .option('--format <fmt>', 'Output format (json)')
  .action(async (opts: { recalculate?: boolean; threshold?: string; all?: boolean; heuristicOnly?: boolean; format?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found. Run a parse command to generate tasks.'));
        return;
      }

      // Check if there are tasks to score
      const scoreAll = opts.all || opts.recalculate;
      if (!scoreAll && tasks.every((t) => t.complexity !== 1)) {
        console.log(chalk.yellow('No unscored tasks found. Use --all to re-score all tasks.'));
        return;
      }

      // Resolve auth
      let authAvailable = false;
      if (!opts.heuristicOnly) {
        const authResult = await resolveActiveAuth(config.ai.provider);
        authAvailable = authResult !== null;
      }

      const result = await executeScore(tasks, config, authAvailable, opts);

      if (result.results.length === 0) {
        console.log(chalk.yellow('No unscored tasks found. Use --all to re-score all tasks.'));
        return;
      }

      console.log(chalk.dim(`Scored by: ${result.providerLabel}\n`));
      await writeTasks(resolved.projectDir, result.tasks);

      if (opts.format === 'json') {
        console.log(JSON.stringify(result.results, null, 2));
        return;
      }

      // Build complexity report context
      const scoredTasks = result.results.map((r) => {
        const task = findTaskById(tasks, r.taskId);
        return task!;
      });

      const low = result.results.filter((r) => r.label === 'low').length;
      const medium = result.results.filter((r) => r.label === 'medium').length;
      const high = result.results.filter((r) => r.label === 'high').length;
      const average = result.results.length > 0
        ? Math.round((result.results.reduce((sum, r) => sum + r.score, 0) / result.results.length) * 10) / 10
        : 0;

      const context: ComplexityReportContext = {
        tasks: scoredTasks,
        summary: { low, medium, high, average },
      };

      setProjectPath(resolved.projectDir);
      const output = renderToTerminal('complexity-report', context as unknown as Record<string, unknown>);
      console.log(output);

      // Threshold warnings
      const threshold = opts.threshold
        ? parseInt(opts.threshold, 10)
        : config.thresholds.flag;
      const flagged = result.results.filter((r) => r.score >= threshold);
      if (flagged.length > 0) {
        console.log(chalk.yellow(`\n${flagged.length} task(s) at or above threshold (${threshold}):`));
        for (const r of flagged) {
          const task = findTaskById(tasks, r.taskId);
          console.log(chalk.yellow(`  ${r.taskId}: ${task?.title} (score: ${r.score})`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- expand ---
program
  .command('expand <id>')
  .description('Auto-decompose a task into subtasks')
  .option('--force', 'Skip confirmation prompt')
  .option('--max-subtasks <n>', 'Maximum subtasks to generate')
  .action(async (id: string, opts: { force?: boolean; maxSubtasks?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);

      const task = findTaskById(tasks, id);
      if (!task) {
        console.error(chalk.red(`Error: Task "${id}" not found.`));
        process.exitCode = 1;
        return;
      }

      // Validate expandability
      const validationError = validateExpandable(task, config.style, opts.force);
      if (validationError) {
        console.error(chalk.red(validationError));
        process.exitCode = 1;
        return;
      }

      // Confirmation prompt (unless --force)
      const maxSubtasks = opts.maxSubtasks ? parseInt(opts.maxSubtasks, 10) : undefined;
      const confirmResult = await confirmExpand(
        [{ id: task.id, title: task.title, complexity: task.complexity }],
        opts.force ? { confirmed: true, maxSubtasks } : { maxSubtasks },
      );
      if (!confirmResult.confirmed) {
        console.log(chalk.dim('Expansion cancelled.'));
        return;
      }

      // Resolve auth for AI expansion
      const authResult = await resolveActiveAuth(config.ai.provider);
      const authAvailable = authResult !== null;

      const result = await executeExpand(tasks, id, config, {
        force: opts.force,
        maxSubtasks: confirmResult.maxSubtasks,
        authAvailable,
      });

      await writeTasks(resolved.projectDir, result.tasks);

      console.log(
        chalk.green(`Expanded ${task.id} into ${result.children.length} subtask(s):`),
      );
      for (const child of result.children) {
        console.log(chalk.dim(`  ${child.id}: ${child.title}`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- expand-all ---
program
  .command('expand-all')
  .description('Expand all tasks above the complexity threshold')
  .option('--threshold <n>', 'Complexity threshold')
  .option('--dry-run', 'Preview without making changes')
  .option('--force', 'Skip confirmation prompt')
  .action(async (opts: { threshold?: string; dryRun?: boolean; force?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found. Run a parse command first.'));
        return;
      }

      const threshold = opts.threshold
        ? parseInt(opts.threshold, 10)
        : config.thresholds.expand;

      const candidates = findExpandCandidates(tasks, threshold);

      if (candidates.length === 0) {
        console.log(
          chalk.yellow(
            `No expandable tasks found above threshold (${threshold}). ` +
              'All qualifying tasks may already be expanded.',
          ),
        );
        return;
      }

      // Dry-run: show preview table
      if (opts.dryRun) {
        console.log(
          chalk.bold(`Would expand ${candidates.length} task(s) (threshold: ${threshold}):\n`),
        );
        for (const t of candidates) {
          console.log(
            `  ${chalk.bold(t.id)}  ${chalk.dim(`"${t.title}"`)}  ` +
              `complexity: ${t.complexity}  -> ${t.estimatedSubtasks} subtasks`,
          );
        }
        return;
      }

      // Confirmation
      const bulkConfirm = await confirmBulkOperation(
        'Expand',
        candidates.length,
        { force: opts.force },
      );
      if (!bulkConfirm.confirmed) {
        console.log(chalk.dim('Expansion cancelled.'));
        return;
      }

      // Resolve auth
      const authResult = await resolveActiveAuth(config.ai.provider);
      const authAvailable = authResult !== null;

      const result = await executeExpandAll(tasks, config, {
        threshold,
        authAvailable,
      });

      await writeTasks(resolved.projectDir, result.tasks);

      if (result.expanded.length > 0) {
        console.log(
          chalk.green(
            `Expanded ${result.expanded.length} task(s):`,
          ),
        );
        for (const exp of result.expanded) {
          console.log(
            chalk.dim(`  ${exp.parentId}: ${exp.children.length} subtask(s)`),
          );
        }
      }

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n${result.errors.length} task(s) skipped:`));
        for (const error of result.errors) {
          console.log(chalk.yellow(`  ${error.parentId}: ${error.reason}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- set-status ---
program
  .command('set-status <id> <status>')
  .description('Update task state')
  .option('--cascade', 'Propagate status to children')
  .option('--force', 'Bypass transition rules')
  .action(async (id: string, newStatus: string, opts: { cascade?: boolean; force?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const states = resolveStates(config.states);
      const tasks = await readTasks(resolved.projectDir);

      if (opts.force) {
        console.log(chalk.yellow('Warning: Transition rules bypassed with --force.'));
      }

      const result = executeSetStatus(tasks, id, newStatus, states, config.states.enforce_transitions, {
        cascade: opts.cascade,
        force: opts.force,
      });

      await writeTasks(resolved.projectDir, result.tasks);

      console.log(
        chalk.green(`Updated ${id}: ${chalk.dim(result.oldStatus)} → ${chalk.bold(result.newStatus)}`),
      );

      if (opts.cascade && result.cascadedCount > 0) {
        console.log(chalk.dim(`  Cascaded to ${result.cascadedCount} child task(s).`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- add ---
program
  .command('add [type]')
  .description('Interactive task creation')
  .option('--title <title>', 'Task title')
  .option('--type <type>', 'Task type (epic, story, task, subtask)')
  .option('--parent <id>', 'Parent task ID')
  .option('--priority <priority>', 'Task priority (critical, high, medium, low)')
  .option('--skills <skills>', 'Required skills (comma-separated)')
  .action(async (typeArg: string | undefined, opts: { title?: string; type?: string; parent?: string; priority?: string; skills?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);

      const addOpts: AddCommandOpts = {
        typeArg,
        title: opts.title,
        type: opts.type,
        priority: opts.priority,
        parent: opts.parent,
        skills: opts.skills,
      };

      const result = await executeAdd(tasks, config, addOpts);
      await writeTasks(resolved.projectDir, result.tasks);

      console.log(chalk.green(`Created task ${chalk.bold(result.task.id)}: ${result.task.title}`));
      console.log(chalk.dim(`  Type: ${result.task.type} | Priority: ${result.task.priority} | Status: ${result.task.status}`));
      if (result.task.requiredSkills.length > 0) {
        console.log(chalk.dim(`  Skills: ${result.task.requiredSkills.join(', ')}`));
      }
      if (addOpts.parent) {
        console.log(chalk.dim(`  Parent: ${addOpts.parent}`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- remove ---
program
  .command('remove <id>')
  .description('Remove a task and its children')
  .option('--force', 'Skip confirmation prompt')
  .action(async (id: string, opts: { force?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const states = resolveStates(config.states);
      const tasks = await readTasks(resolved.projectDir);

      const task = findTaskById(tasks, id);
      if (!task) {
        console.error(chalk.red(`Error: Task "${id}" not found.`));
        process.exitCode = 1;
        return;
      }

      // Confirmation prompt
      const childCount = task.children.length;
      const confirmation = await confirmRemove(id, task.title, childCount, { force: opts.force });
      if (!confirmation.confirmed) {
        console.log(chalk.dim('Remove cancelled.'));
        return;
      }

      const result = executeRemove(tasks, id, states);
      await writeTasks(resolved.projectDir, result.tasks);

      console.log(chalk.green(`Removed ${result.removedIds.length} task(s): ${result.removedIds.join(', ')}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- qa-fail ---
program
  .command('qa-fail <id>')
  .description('Report a QA test failure for a task')
  .option('--test-type <type>', 'Test type (component|integration|api|e2e|unit|manual|other)')
  .option('--description <desc>', 'What failed')
  .option('--cause <cause>', 'Likely root cause')
  .option('--severity <sev>', 'Severity (critical|major|minor)', 'major')
  .option('--reporter <name>', 'Who reported', 'qa-agent')
  .option('--cascade', 'Also set children to qa-failed')
  .option('--force', 'Bypass transition rules')
  .option('--no-interactive', 'Skip prompts, require flags')
  .action(async (id: string, opts: {
    testType?: string;
    description?: string;
    cause?: string;
    severity?: string;
    reporter?: string;
    cascade?: boolean;
    force?: boolean;
    interactive?: boolean;
  }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const states = resolveStates(config.states);
      const tasks = await readTasks(resolved.projectDir);

      let testType = opts.testType as QAFailOpts['testType'];
      let description = opts.description ?? '';

      // Interactive prompts if flags not provided
      if (opts.interactive !== false && (!testType || !description)) {
        const { select, input } = await import('@inquirer/prompts');
        if (!testType) {
          testType = await select({
            message: 'Test type:',
            choices: [
              { name: 'component', value: 'component' },
              { name: 'integration', value: 'integration' },
              { name: 'api', value: 'api' },
              { name: 'e2e', value: 'e2e' },
              { name: 'unit', value: 'unit' },
              { name: 'manual', value: 'manual' },
              { name: 'other', value: 'other' },
            ],
          }) as QAFailOpts['testType'];
        }
        if (!description) {
          description = await input({ message: 'What failed:' });
        }
      }

      if (!testType) {
        console.error(chalk.red('Error: --test-type is required when using --no-interactive.'));
        process.exitCode = 1;
        return;
      }
      if (!description) {
        console.error(chalk.red('Error: --description is required when using --no-interactive.'));
        process.exitCode = 1;
        return;
      }

      const result = executeQAFail(tasks, id, states, config.states.enforce_transitions, {
        testType,
        description,
        cause: opts.cause,
        severity: (opts.severity as QAFailOpts['severity']) ?? 'major',
        reporter: opts.reporter,
        cascade: opts.cascade,
        force: opts.force,
      });

      await writeTasks(resolved.projectDir, result.tasks);

      console.log(
        chalk.red(`QA Failed ${chalk.bold(id)}: ${chalk.dim(result.oldStatus)} → ${chalk.bold('qa-failed')}`),
      );
      console.log(chalk.dim(`  Test type: ${testType} | Severity: ${opts.severity ?? 'major'}`));
      console.log(chalk.dim(`  Description: ${description}`));

      if (result.taggedDependents.length > 0) {
        console.log(chalk.yellow(`  Tagged ${result.taggedDependents.length} dependent(s) with qa-review-needed: ${result.taggedDependents.join(', ')}`));
      }
      if (result.pulledBackDependents.length > 0) {
        console.log(chalk.yellow(`  Pulled back ${result.pulledBackDependents.length} dependent(s) from done: ${result.pulledBackDependents.join(', ')}`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- qa-clear ---
program
  .command('qa-clear <id>')
  .description('Clear qa-review-needed tag after reviewing impact and rerunning tests')
  .option('--reporter <name>', 'Who verified', 'qa-agent')
  .option('--note <text>', 'Optional note about what was reviewed/retested')
  .action(async (id: string, opts: { reporter?: string; note?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const states = resolveStates(config.states);
      const tasks = await readTasks(resolved.projectDir);

      const result = executeQAClear(tasks, id, states, {
        reporter: opts.reporter,
        note: opts.note,
      });

      await writeTasks(resolved.projectDir, result.tasks);

      if (result.tagRemoved) {
        console.log(chalk.green(`Cleared qa-review-needed tag from ${chalk.bold(id)}`));
      } else {
        console.log(chalk.yellow(`Task ${chalk.bold(id)} did not have qa-review-needed tag (recorded pass entry anyway).`));
      }
      if (opts.note) {
        console.log(chalk.dim(`  Note: ${opts.note}`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- qa-fail-batch ---
program
  .command('qa-fail-batch')
  .description('Report multiple QA failures atomically (single readiness recompute)')
  .option('--file <path>', 'Read failures from a JSON file')
  .option('--json <string>', 'Inline JSON array of failures')
  .option('--reporter <name>', 'Default reporter for all entries (overridable per-entry)')
  .option('--cascade', 'Cascade qa-failed to children of each failed task')
  .option('--force', 'Bypass transition rules')
  .action(async (opts: {
    file?: string;
    json?: string;
    reporter?: string;
    cascade?: boolean;
    force?: boolean;
  }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const states = resolveStates(config.states);
      const tasks = await readTasks(resolved.projectDir);

      // Parse input
      let rawEntries: QAFailBatchEntry[];
      if (opts.file) {
        const filePath = resolve(opts.file);
        if (!existsSync(filePath)) {
          console.error(chalk.red(`Error: File "${opts.file}" not found.`));
          process.exitCode = 1;
          return;
        }
        const content = await readFile(filePath, 'utf-8');
        rawEntries = JSON.parse(content);
      } else if (opts.json) {
        rawEntries = JSON.parse(opts.json);
      } else {
        console.error(chalk.red('Error: Provide --file <path> or --json <string>.'));
        process.exitCode = 1;
        return;
      }

      if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        console.error(chalk.red('Error: Input must be a non-empty JSON array.'));
        process.exitCode = 1;
        return;
      }

      // Apply default reporter
      if (opts.reporter) {
        for (const entry of rawEntries) {
          if (!entry.reporter) {
            entry.reporter = opts.reporter;
          }
        }
      }

      const result = executeQAFailBatch(tasks, rawEntries, states, config.states.enforce_transitions, {
        cascade: opts.cascade,
        force: opts.force,
      });

      await writeTasks(resolved.projectDir, result.tasks);

      // Output summary
      if (result.entries.length > 0) {
        console.log(chalk.red(`QA Failed ${result.summary.failed} task(s) atomically:`));
        for (const entry of result.entries) {
          console.log(chalk.dim(`  ${entry.taskId}: ${entry.oldStatus} → qa-failed (${entry.feedbackEntry.severity})`));
        }
        if (result.summary.dependentsTagged > 0) {
          console.log(chalk.yellow(`  Tagged ${result.summary.dependentsTagged} unique dependent(s) with qa-review-needed`));
        }
        if (result.summary.dependentsPulledBack > 0) {
          console.log(chalk.yellow(`  Pulled back ${result.summary.dependentsPulledBack} dependent(s) from done`));
        }
        console.log(chalk.dim(`  Severity: ${result.summary.critical} critical, ${result.summary.major} major, ${result.summary.minor} minor`));
      }

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n${result.errors.length} entry/entries skipped:`));
        for (const err of result.errors) {
          console.log(chalk.yellow(`  ${err.taskId}: ${err.error}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- qa-clear-batch ---
program
  .command('qa-clear-batch [ids...]')
  .description('Clear qa-review-needed tags from multiple tasks atomically')
  .option('--file <path>', 'Read clears from a JSON file (for per-task notes)')
  .option('--reporter <name>', 'Default reporter for all entries', 'qa-agent')
  .option('--note <text>', 'Default note for all entries (when using positional IDs)')
  .action(async (ids: string[], opts: {
    file?: string;
    reporter?: string;
    note?: string;
  }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const states = resolveStates(config.states);
      const tasks = await readTasks(resolved.projectDir);

      let clearEntries: QAClearBatchEntry[];

      if (opts.file) {
        const filePath = resolve(opts.file);
        if (!existsSync(filePath)) {
          console.error(chalk.red(`Error: File "${opts.file}" not found.`));
          process.exitCode = 1;
          return;
        }
        const content = await readFile(filePath, 'utf-8');
        clearEntries = JSON.parse(content);
      } else if (ids.length > 0) {
        // Build entries from positional args
        clearEntries = ids.map((id) => ({
          taskId: id,
          reporter: opts.reporter,
          note: opts.note,
        }));
      } else {
        console.error(chalk.red('Error: Provide task IDs as arguments or use --file <path>.'));
        process.exitCode = 1;
        return;
      }

      if (!Array.isArray(clearEntries) || clearEntries.length === 0) {
        console.error(chalk.red('Error: Input must be a non-empty list.'));
        process.exitCode = 1;
        return;
      }

      const result = executeQAClearBatch(tasks, clearEntries, states);

      await writeTasks(resolved.projectDir, result.tasks);

      // Output summary
      if (result.entries.length > 0) {
        const cleared = result.entries.filter((e) => e.tagRemoved).length;
        console.log(chalk.green(`Cleared qa-review-needed from ${cleared} task(s):`));
        for (const entry of result.entries) {
          const status = entry.tagRemoved ? chalk.green('cleared') : chalk.dim('(tag not present)');
          console.log(chalk.dim(`  ${entry.taskId}: ${status}`));
        }
      }

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n${result.errors.length} entry/entries skipped:`));
        for (const err of result.errors) {
          console.log(chalk.yellow(`  ${err.taskId}: ${err.error}`));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- report ---
program
  .command('report')
  .description('Generate project report')
  .option('--type <type>', 'Report type (summary|complexity|progress|dependencies)', 'summary')
  .option('--format <fmt>', 'Output format (json|yaml|md|table)', 'table')
  .option('--template <name>', 'Custom template name (overrides --type)')
  .action(async (opts: { type: string; format: string; template?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);
      const states = resolveStates(config.states);

      const result = await executeReport(tasks, states, opts);
      await writeTasks(resolved.projectDir, result.tasks);

      setProjectPath(resolved.projectDir);

      const format = opts.format as ReportFormat;
      switch (format) {
        case 'json':
          console.log(JSON.stringify(result.context, null, 2));
          break;
        case 'yaml':
          console.log(yaml.dump(result.context as Record<string, unknown>, { lineWidth: -1, noRefs: true }));
          break;
        case 'md':
          console.log(renderToMarkdown(result.templateName, result.context));
          break;
        case 'table':
        default:
          console.log(renderToTerminal(result.templateName, result.context));
          break;
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- next ---
program
  .command('next')
  .description('Show the single highest-priority ready task')
  .action(async () => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);
      const states = resolveStates(config.states);

      const result = executeNext(tasks, states);
      await writeTasks(resolved.projectDir, result.tasks);

      if (!result.task) {
        console.log(chalk.yellow('No ready tasks found.'));
        return;
      }

      const next = result.task;
      console.log(chalk.bold.green('Next task:'));
      console.log(`  ${chalk.bold('ID:')}         ${next.id}`);
      console.log(`  ${chalk.bold('Title:')}      ${next.title}`);
      console.log(`  ${chalk.bold('Priority:')}   ${next.priority}`);
      console.log(`  ${chalk.bold('Complexity:')} ${next.complexity}`);
      if (next.requiredSkills.length > 0) {
        console.log(`  ${chalk.bold('Skills:')}     ${next.requiredSkills.join(', ')}`);
      }
      if (next.outputs.length > 0) {
        console.log(`  ${chalk.bold('Outputs:')}    ${next.outputs.join(', ')}`);
      }
      if (next.description) {
        console.log(`  ${chalk.bold('Description:')} ${next.description}`);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- ready ---
program
  .command('ready')
  .description('Output delegation manifest of all ready tasks')
  .option('--format <fmt>', 'Output format (json|yaml|table)', 'table')
  .option('--skills <skills>', 'Filter by required skills (comma-separated)')
  .action(async (opts: { format: string; skills?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);
      const states = resolveStates(config.states);

      const result = executeReady(tasks, states, opts);
      await writeTasks(resolved.projectDir, result.tasks);

      const manifest = result.manifest;

      if (opts.format === 'json') {
        console.log(JSON.stringify(manifest, null, 2));
      } else if (opts.format === 'yaml') {
        console.log(yaml.dump(manifest, { lineWidth: -1, noRefs: true }));
      } else {
        if (manifest.qa_failed_tasks.length > 0) {
          console.log(chalk.bold.red(`\nQA Failed Tasks (${manifest.qa_failed_tasks.length}):`));
          const qaTable = new Table({
            head: ['ID', 'Title', 'Priority', 'Severity', 'Test Type', 'Description'],
            style: { head: ['red'] },
          });
          for (const t of manifest.qa_failed_tasks) {
            qaTable.push([t.id, t.title, t.priority, t.latest_feedback.severity, t.latest_feedback.test_type, t.latest_feedback.description]);
          }
          console.log(qaTable.toString());
        }

        console.log(chalk.bold.green(`\nReady Tasks (${manifest.ready_tasks.length}):`));
        if (manifest.ready_tasks.length > 0) {
          const readyTable = new Table({
            head: ['ID', 'Title', 'Priority', 'Complexity', 'Skills'],
            style: { head: ['cyan'] },
          });
          for (const t of manifest.ready_tasks) {
            readyTable.push([t.id, t.title, t.priority, t.complexity, t.required_skills.join(', ') || '-']);
          }
          console.log(readyTable.toString());
        } else {
          console.log(chalk.yellow('  No ready tasks.'));
        }

        if (manifest.blocked_tasks.length > 0) {
          console.log(chalk.bold.yellow(`\nBlocked Tasks (${manifest.blocked_tasks.length}):`));
          const blockedTable = new Table({
            head: ['ID', 'Title', 'Waiting On'],
            style: { head: ['yellow'] },
          });
          for (const t of manifest.blocked_tasks) {
            blockedTable.push([t.id, t.title, t.waiting_on.join(', ')]);
          }
          console.log(blockedTable.toString());
        }

        console.log(chalk.bold(`\nSummary:`));
        console.log(`  Total: ${manifest.summary.total}  Ready: ${manifest.summary.ready}  Blocked: ${manifest.summary.blocked}  In Progress: ${manifest.summary.in_progress}  QA Failed: ${manifest.summary.qa_failed}  Completed: ${manifest.summary.completed}`);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- validate ---
program
  .command('validate')
  .description('Check dependency graph for cycles, orphans, and skill violations')
  .option('--fix', 'Auto-repair issues')
  .action(async (opts: { fix?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);
      const states = resolveStates(config.states);
      const vocabulary = getEffectiveVocabulary(config.skills.vocabulary);

      const result = executeValidate(tasks, states, vocabulary, !!opts.fix);

      // If fixes were applied, persist
      if (opts.fix && result.fixes && result.fixes.length > 0) {
        await writeTasks(resolved.projectDir, result.tasks);

        console.log(chalk.bold.green(`\nFixes applied (${result.fixes.length}):`));
        for (const fix of result.fixes) {
          console.log(`  ${chalk.green('+')} [${fix.taskId}] ${fix.detail}`);
        }
      }

      // Report cycles
      if (result.cycles.hasCycle) {
        console.log(chalk.bold.red(`\nCycles detected:`));
        console.log(`  Nodes involved: ${result.cycles.cycleNodes.join(', ')}`);
      } else {
        console.log(chalk.green('\nNo cycles detected.'));
      }

      // Report dangling references
      if (result.danglingRefs.length > 0) {
        console.log(chalk.bold.red(`\nDangling references (${result.danglingRefs.length}):`));
        for (const ref of result.danglingRefs) {
          console.log(`  [${ref.taskId}] references non-existent task "${ref.referencedId}"`);
        }
      } else {
        console.log(chalk.green('No dangling references.'));
      }

      // Report skill issues
      if (result.skillIssues.length > 0) {
        console.log(chalk.bold.yellow(`\nSkill vocabulary issues (${result.skillIssues.length}):`));
        for (const issue of result.skillIssues) {
          const suggestion = issue.suggestion ? ` (did you mean "${issue.suggestion}"?)` : '';
          console.log(`  [${issue.taskId}] unknown skill "${issue.skill}"${suggestion}`);
        }
      } else {
        console.log(chalk.green('No skill vocabulary issues.'));
      }

      // Overall status
      if (result.isValid) {
        console.log(chalk.bold.green('\nValidation passed.'));
      } else {
        console.log(chalk.bold.red('\nValidation failed.'));
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- generate ---
program
  .command('generate')
  .description('Regenerate YAML task files from tasks.json')
  .option('--force', 'Overwrite existing files')
  .option('--format <fmt>', 'Output format (yaml|md)')
  .action(async () => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const tasks = await readTasks(resolved.projectDir);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found in tasks.json.'));
        return;
      }

      const result = await executeGenerate(resolved.projectDir, tasks);
      console.log(chalk.green(`Generated ${result.files.length} YAML task file(s) in tasks/.`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- sync ---
program
  .command('sync')
  .description('Merge edits from YAML task files back into tasks.json')
  .option('--dry-run', 'Preview changes without writing')
  .option('--diff', 'Show diff')
  .action(async (opts: { dryRun?: boolean; diff?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const result = await executeSync(resolved.projectDir, { dryRun: opts.dryRun });

      if (result.changes.length === 0) {
        console.log(chalk.green('Everything is in sync.'));
        return;
      }

      for (const change of result.changes) {
        console.log(chalk.bold(`\n  ${change.taskId}:`));
        for (const diff of change.diffs) {
          if (opts.diff) {
            console.log(chalk.red(`    - ${diff.field}: ${JSON.stringify(diff.jsonValue)}`));
            console.log(chalk.green(`    + ${diff.field}: ${JSON.stringify(diff.yamlValue)}`));
          } else {
            console.log(`    ${diff.field} changed`);
          }
        }
      }

      if (opts.dryRun) {
        console.log(chalk.yellow(`\n${result.changes.length} task(s) would be updated (dry-run).`));
      } else {
        console.log(chalk.green(`\n${result.changes.length} task(s) updated in tasks.json.`));
      }

      if (result.missingInJson.length > 0) {
        console.log(chalk.yellow(`\nYAML files with no matching task in tasks.json: ${result.missingInJson.join(', ')}`));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- config ---
program
  .command('config')
  .description('Interactive configuration editor')
  .option('--set <key=value>', 'Set a configuration value')
  .option('--get <key>', 'Get a configuration value')
  .action(async (opts: { set?: string; get?: string }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);

      // --get key
      if (opts.get) {
        const result = executeConfigGet(config, opts.get);
        console.log(result.value);
        return;
      }

      // --set key=value
      if (opts.set) {
        const eqIndex = opts.set.indexOf('=');
        if (eqIndex === -1) {
          console.error(chalk.red('Error: --set requires format key=value'));
          process.exitCode = 1;
          return;
        }
        const key = opts.set.substring(0, eqIndex);
        const value = opts.set.substring(eqIndex + 1);
        const result = executeConfigSet(key, value);
        await writeProjectConfig(resolved.projectDir, result.patch);
        console.log(chalk.green(`Set ${result.key} = ${result.value}`));
        return;
      }

      // Interactive editor
      const result = await executeConfigEdit(config);
      if (!result) {
        console.log(chalk.dim('No changes made.'));
        return;
      }
      await writeProjectConfig(resolved.projectDir, result.patch);
      console.log(chalk.green(`Set ${result.key} = ${result.value}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- auth (subcommands) ---
const auth = program
  .command('auth')
  .description('Authentication with AI providers (Copilot, Anthropic, OpenAI)');

auth
  .command('login')
  .description('Authenticate with an AI provider')
  .option('--provider <provider>', 'Provider (copilot, anthropic, openai)')
  .option('--force', 'Skip cached credentials and force interactive OAuth flow')
  .action(async (opts: { provider?: string; force?: boolean }) => {
    try {
      await bootstrapHome();

      let providerName: AIProviderName;

      if (opts.provider) {
        if (!AI_PROVIDERS.includes(opts.provider as AIProviderName)) {
          console.error(chalk.red(`Unknown provider "${opts.provider}". Valid: ${AI_PROVIDERS.join(', ')}`));
          process.exitCode = 1;
          return;
        }
        providerName = opts.provider as AIProviderName;
      } else {
        const { select } = await import('@inquirer/prompts');
        providerName = await select({
          message: 'Select AI provider:',
          choices: [
            { name: 'GitHub Copilot (device flow)', value: 'copilot' as AIProviderName },
            { name: 'Anthropic Claude (OAuth)', value: 'anthropic' as AIProviderName },
            { name: 'OpenAI ChatGPT (OAuth)', value: 'openai' as AIProviderName },
          ],
        });
      }

      const result = await executeAuthLogin(providerName, { force: opts.force });
      console.log(chalk.green(`\nAuthenticated with ${result.providerName} as ${result.displayName}`));
      console.log(chalk.dim(`  Credentials stored in ${APP_CONFIG_DIR_DISPLAY}/auth.json`));
      console.log(chalk.dim(`  Active provider set to: ${result.providerName}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

auth
  .command('status')
  .description('Show authentication status for all providers')
  .option('--verbose', 'Show detailed token info')
  .action(async (opts: { verbose?: boolean }) => {
    try {
      await bootstrapHome();

      const result = await executeAuthStatus();
      console.log(chalk.bold(`Active provider: ${result.activeProvider}\n`));

      let anyAuth = false;
      for (const entry of result.entries) {
        const marker = entry.isActive ? chalk.green(' (active)') : '';
        if (entry.authenticated) {
          anyAuth = true;
          console.log(`  ${chalk.bold(entry.name)}${marker}: ${chalk.green(entry.displayName)} (${entry.source})`);
        } else {
          console.log(`  ${chalk.bold(entry.name)}${marker}: ${chalk.dim('not authenticated')}`);
        }
      }

      if (!anyAuth) {
        console.log(chalk.yellow(`\nNo providers authenticated. Run "${CLI_BIN_NAME} auth login" to connect.`));
      }

      if (opts.verbose) {
        try {
          const gitRoot = await detectGitRoot();
          const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
          const config = await loadProjectConfig(resolved.projectDir);
          console.log(chalk.dim(`\n  Configured provider: ${config.ai.provider}`));
          console.log(chalk.dim(`  Configured model: ${config.ai.model}`));
        } catch {
          console.log(chalk.dim('\n  Configured model: (no active project)'));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

auth
  .command('switch <provider>')
  .description('Switch active AI provider without re-authenticating')
  .action(async (providerArg: string) => {
    try {
      await bootstrapHome();
      const result = await executeAuthSwitch(providerArg);
      console.log(chalk.green(`Switched active provider to ${result.providerName}.`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

auth
  .command('logout')
  .description('Revoke stored credentials for a provider')
  .option('--provider <provider>', 'Provider to log out (default: active provider)')
  .action(async (opts: { provider?: string }) => {
    try {
      await bootstrapHome();
      const result = await executeAuthLogout(opts);
      if (result.envWarning) {
        console.log(chalk.yellow(result.envWarning));
      }
      console.log(chalk.green(`Logged out from ${result.providerName}. Credentials removed.`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- projects (subcommands) ---
const projects = program
  .command('projects')
  .description('Multi-project management');

projects
  .command('list')
  .description('List all projects with active marker and location tags')
  .action(async () => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const result = await executeProjectsList(gitRoot);

      if (result.projects.length === 0) {
        console.log(chalk.yellow(`No projects found. Run '${CLI_BIN_NAME} projects create <name>' to create one.`));
        return;
      }

      console.log(chalk.bold('\nProjects:\n'));
      for (const project of result.projects) {
        const isActive = project.name === result.active && project.location === result.activeLocation;
        const marker = isActive ? chalk.green(' (active)') : '';
        const locationTag = chalk.dim(` [${project.location}]`);
        console.log(`  ${chalk.bold(project.name)}${locationTag}${marker}`);
        if (project.description) {
          console.log(`    ${chalk.dim(project.description)}`);
        }
        console.log(`    ${chalk.dim(`Created: ${project.created}`)}`);
      }
      console.log();
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

projects
  .command('create <name>')
  .description('Create a new project')
  .option('--description <desc>', 'Project description')
  .option('--style <style>', 'Project style')
  .option('--repo', 'Store project data in the current repository')
  .action(async (name: string, opts: { description?: string; style?: string; repo?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const location: ProjectLocation = opts.repo ? 'repo' : 'home';

      if (location === 'repo' && !gitRoot) {
        console.error(chalk.red('Error: --repo requires being inside a git repository.'));
        process.exitCode = 1;
        return;
      }

      if (location === 'repo' && gitRoot) {
        await bootstrapRepoHome(gitRoot);
      }

      const result = await executeProjectsCreate(name, location, gitRoot, opts.description ?? '');
      const locationTag = result.location === 'repo' ? ' [repo]' : ' [home]';
      const displayDir = result.location === 'repo' ? APP_REPO_CONFIG_DIR_DISPLAY : APP_CONFIG_DIR_DISPLAY;
      console.log(chalk.green(`\nProject "${result.name}"${locationTag} created and set as active.`));
      console.log(chalk.dim(`  Directory: ${displayDir}/${result.name}/`));
      console.log(chalk.dim(`  Config: config.yaml | Tasks: tasks.json`));
      console.log();
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

projects
  .command('switch <name>')
  .description('Set the active project (searches both home and repo)')
  .action(async (name: string) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const result = await executeProjectsSwitch(name, gitRoot);
      console.log(chalk.green(`Switched active project to "${result.name}" [${result.location}].`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

projects
  .command('remove <name>')
  .description('Remove a project from the registry')
  .option('--force', 'Skip confirmation')
  .action(async (name: string, opts: { force?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();

      if (!opts.force) {
        console.log(chalk.yellow(`Warning: This will remove project "${name}" from the registry.`));
        console.log(chalk.yellow('Project data directory will NOT be deleted.'));
        console.log(chalk.yellow('Use --force to skip this warning.'));
        return;
      }

      const result = await executeProjectsRemove(name, gitRoot);
      console.log(chalk.green(`Project "${result.name}" [${result.location}] removed from registry.`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- blueprint (subcommands) ---
const blueprint = program
  .command('blueprint')
  .description('Application archetype blueprints for cross-cutting concerns');

blueprint
  .command('list')
  .description('List all available archetype blueprints')
  .action(async () => {
    try {
      const { listBlueprints } = await import('./blueprints/index.js');
      const blueprints = listBlueprints();

      setProjectPath('');
      const output = renderToTerminal('blueprint-list', { blueprints });
      console.log(output);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

blueprint
  .command('show <id>')
  .description('Show full concern matrix for a blueprint')
  .option('--urgency <tier>', 'Filter by urgency tier (upfront|pattern-first|deferred)')
  .action(async (id: string, opts: { urgency?: string }) => {
    try {
      const { getBlueprint, groupByUrgency } = await import('./blueprints/index.js');
      const bp = getBlueprint(id);

      if (!bp) {
        const { BLUEPRINT_IDS } = await import('./blueprints/index.js');
        console.error(chalk.red(`Blueprint "${id}" not found. Available: ${BLUEPRINT_IDS.join(', ')}`));
        process.exitCode = 1;
        return;
      }

      const groups = groupByUrgency(bp.concerns);

      let upfront = groups.upfront;
      let patternFirst = groups['pattern-first'];
      let deferred = groups.deferred;

      // Filter by urgency if requested
      if (opts.urgency) {
        if (opts.urgency === 'upfront') { patternFirst = []; deferred = []; }
        else if (opts.urgency === 'pattern-first') { upfront = []; deferred = []; }
        else if (opts.urgency === 'deferred') { upfront = []; patternFirst = []; }
      }

      setProjectPath('');
      const output = renderToTerminal('blueprint-detail', {
        blueprint: bp,
        upfront,
        patternFirst,
        deferred,
        totalConcerns: bp.concerns.length,
        nonNegotiableCount: bp.nonNegotiableBundle.length,
      });
      console.log(output);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

blueprint
  .command('apply <id>')
  .description('Apply a blueprint to the current project, generating concern tasks')
  .option('--answers <json>', 'JSON string of context answers (for CI/non-interactive)')
  .option('--flat', 'Generate flat top-level tasks instead of grouped by tier')
  .option('--no-interactive', 'Skip interactive prompts')
  .action(async (id: string, opts: { answers?: string; flat?: boolean; interactive?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);

      // Gather context answers
      let contextAnswers: Record<string, string | boolean | string[]>;
      if (opts.answers) {
        contextAnswers = JSON.parse(opts.answers);
      } else if (opts.interactive === false) {
        const { getBlueprint } = await import('./blueprints/index.js');
        const bp = getBlueprint(id);
        contextAnswers = {};
        if (bp) {
          for (const q of bp.contextQuestions) {
            if (q.default !== undefined) {
              contextAnswers[q.id] = q.default;
            }
          }
        }
      } else {
        const { getBlueprint } = await import('./blueprints/index.js');
        const bp = getBlueprint(id);
        if (!bp) {
          const { BLUEPRINT_IDS } = await import('./blueprints/index.js');
          console.error(chalk.red(`Blueprint "${id}" not found. Available: ${BLUEPRINT_IDS.join(', ')}`));
          process.exitCode = 1;
          return;
        }
        const { runBlueprintQuestions } = await import('./prompts/blueprint-questions.js');
        contextAnswers = await runBlueprintQuestions(bp.contextQuestions);
      }

      const existingTasks = await readTasks(resolved.projectDir);
      const result = await executeBlueprintApply(id, existingTasks, config, contextAnswers, { flat: opts.flat });

      await writeTasks(resolved.projectDir, result.allTasks);
      await writeProjectConfig(resolved.projectDir, {
        blueprint: { id, contextAnswers: result.contextAnswers },
      });

      console.log(chalk.green(`Applied blueprint "${result.blueprintName}" — ${result.newTasks.length} top-level task(s) (${result.totalTasks} total)`));
      console.log(chalk.dim(`  Blueprint: ${result.blueprintId}`));
      console.log(chalk.dim(`  Concerns resolved: ${result.concernsResolved}`));
      console.log(chalk.dim(`  Context answers saved to config.yaml`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

blueprint
  .command('check')
  .description('Check task coverage against the configured blueprint')
  .action(async () => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);

      if (!config.blueprint.id) {
        console.error(chalk.red('No blueprint configured. Run "blueprint apply <id>" first.'));
        process.exitCode = 1;
        return;
      }

      const tasks = await readTasks(resolved.projectDir);
      const result = await executeBlueprintCheck(tasks, config.blueprint.id, config.blueprint.contextAnswers);

      setProjectPath(resolved.projectDir);
      const output = renderToTerminal('blueprint-check', {
        blueprint: result.blueprint,
        concerns: result.concerns,
        coveredCount: result.coveredCount,
        totalCount: result.totalCount,
        missingUpfront: result.missingUpfront,
      });
      console.log(output);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

program
  .command('connect')
  .description('Open the interactive connections view (TUI)')
  .action(() => runConnect());

// Hidden commands
registerRebrand(program);

program.parse();
