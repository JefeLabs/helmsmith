import { Command } from 'commander';
import chalk from 'chalk';
import { bootstrapHome } from './utils/home.js';
import {
  createProject,
  listProjects,
  switchProject,
  removeProject,
  readProjects,
} from './utils/projects.js';
import { resolveProjectOrThrow } from './config/resolver.js';
import { loadProjectConfig, writeProjectConfig } from './config/loader.js';
import { readTasks, writeTasks } from './formats/tasks-store.js';
import { generateTaskFiles } from './formats/task-writer.js';
import { syncTaskFiles } from './formats/sync.js';
import { getProjectDir } from './utils/home.js';
import { resolveStates, validateTransition, findTaskById, getDefaultStatus } from './config/state-engine.js';
import { setProjectPath, renderToTerminal, renderToMarkdown } from './generator/index.js';
import { aggregateReport, REPORT_TYPE_TO_TEMPLATE } from './reports/index.js';
import type { ReportType, ReportFormat } from './reports/types.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parsePlan, getNextId, renumberTasks } from './parser/index.js';
import { writeDefaults } from './utils/defaults.js';
import { runInitWizard, type InitWizardResult } from './prompts/init-wizard.js';
import {
  runConfigEditor,
  getConfigValue,
  validateConfigValue,
  applyConfigValue,
  CONFIG_KEYS,
} from './prompts/config-editor.js';
import { scoreTasks, createScorer } from './scorer/index.js';
import type { ComplexityReportContext } from './generator/types.js';
import { login, resolveGitHubToken, readAuthCredentials, deleteAuthCredentials } from './auth/index.js';
import { expandTask, expandMultiple, getChildType } from './decomposer/index.js';
import { confirmExpand, confirmBulkOperation, confirmRemove } from './prompts/confirmations.js';
import { inferSkills, getEffectiveVocabulary } from './skills/index.js';
import {
  recomputeAllReadiness,
  applyReadiness,
  buildDelegationManifest,
  findNextTask,
  runValidation,
} from './readiness/index.js';
import { executeAdd, type AddCommandOpts } from './commands/add.js';
import { executeRemove } from './commands/remove.js';
import { executeSetStatus } from './commands/set-status.js';
import yaml from 'js-yaml';
import Table from 'cli-table3';

const program = new Command();

program
  .name('agentx-taskmaster')
  .description('CLI-based project task generator with complexity scoring and auto-decomposition')
  .version('0.1.0')
  .option('--project <name>', 'Target a specific project without switching active');

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
  .option('--no-interactive', 'Skip interactive prompts')
  .action(async (opts: { style?: string; name?: string; model?: string; interactive?: boolean }) => {
    try {
      await bootstrapHome();

      // Build flag overrides for --no-interactive
      const flagOverrides: Partial<InitWizardResult> = {};
      if (opts.name) flagOverrides.name = opts.name;
      if (opts.style) flagOverrides.style = opts.style as InitWizardResult['style'];
      if (opts.model) flagOverrides.model = opts.model;

      // --no-interactive: require at least --name, fill rest from defaults
      if (opts.interactive === false) {
        if (!flagOverrides.name) {
          console.error(chalk.red('Error: --name is required when using --no-interactive.'));
          process.exitCode = 1;
          return;
        }
        flagOverrides.description = flagOverrides.description ?? '';
        flagOverrides.style = flagOverrides.style ?? 'task-only';
        flagOverrides.statePreset = 'standard';
        flagOverrides.skills = ['backend', 'frontend', 'database', 'devops', 'testing'];
        flagOverrides.model = flagOverrides.model ?? 'gpt-4.1';
        flagOverrides.thresholds = { expand: 5, flag: 8 };
      }

      const result = await runInitWizard(
        opts.interactive === false
          ? flagOverrides
          : { name: flagOverrides.name, style: flagOverrides.style, model: flagOverrides.model },
      );

      // Create project with wizard config
      const projectConfig = {
        style: result.style,
        states: { preset: result.statePreset, enforce_transitions: false },
        skills: { vocabulary: result.skills, auto_infer: true },
        ai: { model: result.model },
        thresholds: result.thresholds,
      };
      await createProject(result.name, result.description, projectConfig);

      // Save to defaults.yaml (last-used-wins)
      await writeDefaults({
        model: result.model,
        style: result.style,
        statusPreset: result.statePreset,
        skills: result.skills,
        thresholds: result.thresholds,
      });

      console.log(chalk.green(`\nProject "${result.name}" created and set as active.`));
      console.log(chalk.dim(`  Style: ${result.style} | Status preset: ${result.statePreset}`));
      console.log(chalk.dim(`  Model: ${result.model}`));
      console.log(chalk.dim(`  Skills: ${result.skills.join(', ')}`));
      console.log(chalk.dim(`  Thresholds: expand=${result.thresholds.expand}, flag=${result.thresholds.flag}`));
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
  .action(async (file: string, opts: { numTasks?: string; style?: string; append?: boolean; force?: boolean; ai?: boolean }) => {
    try {
      await bootstrapHome();
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);

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
      const existingTasks = await readTasks(projectPath);
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

      const style = opts.style ?? config.style;
      const defaultStatus = getDefaultStatus(config.states);
      const parseOptions = {
        style,
        defaultStatus,
        numTasks: opts.numTasks ? parseInt(opts.numTasks, 10) : undefined,
      };

      let parsedTasks: import('./config/schema.js').TaskNode[];
      let parseMethod: 'ai' | 'structural';
      const warnings: string[] = [];

      // Try AI parsing first (unless --no-ai)
      const useAI = opts.ai !== false;
      if (useAI) {
        const tokenSource = await resolveGitHubToken();
        if (tokenSource) {
          try {
            console.log(chalk.dim('  Sending document to AI for task breakdown...'));
            const { parseWithAI } = await import('./parser/ai-parser.js');
            const aiResult = await parseWithAI(content, config.ai.model, parseOptions);
            if (aiResult && aiResult.tasks.length > 0) {
              parsedTasks = aiResult.tasks;
              parseMethod = 'ai';
              if (aiResult.warning) {
                warnings.push(aiResult.warning);
              }
            } else {
              console.log(chalk.yellow('  AI returned no tasks, falling back to structural parser.'));
              parsedTasks = null!;
              parseMethod = 'structural';
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.yellow(`  AI parsing failed: ${message}`));
            console.log(chalk.yellow('  Falling back to structural parser.'));
            parsedTasks = null!;
            parseMethod = 'structural';
          }
        } else {
          console.log(chalk.dim('  No Copilot auth found, using structural parser.'));
          parsedTasks = null!;
          parseMethod = 'structural';
        }
      } else {
        parsedTasks = null!;
        parseMethod = 'structural';
      }

      // Structural fallback
      if (parseMethod === 'structural' || !parsedTasks) {
        const result = await parsePlan(content, file, parseOptions);
        parsedTasks = result.tasks;
        parseMethod = 'structural';
        warnings.push(...result.warnings);
      }

      // Append or replace
      let finalTasks;
      let newTasks;
      if (opts.append && existingTasks.length > 0) {
        const startId = getNextId(existingTasks);
        const renumbered = renumberTasks(parsedTasks, startId);
        newTasks = renumbered;
        finalTasks = [...existingTasks, ...renumbered];
      } else {
        newTasks = parsedTasks;
        finalTasks = parsedTasks;
      }

      // Skill inference (skip if AI already tagged skills)
      let skillSummary = '';
      if (parseMethod === 'ai') {
        // Count AI-provided skills
        const countWithSkills = (tasks: typeof finalTasks): number =>
          tasks.reduce((sum, t) => sum + (t.requiredSkills.length > 0 ? 1 : 0) + countWithSkills(t.children), 0);
        const tagged = countWithSkills(newTasks);
        if (tagged > 0) {
          skillSummary = `  Skills: ${tagged} task(s) tagged by AI`;
        }
      } else {
        const skillResults = await inferSkills(newTasks, config);
        if (skillResults.length > 0) {
          const aiCount = skillResults.filter((r) => r.method === 'ai').length;
          const kwCount = skillResults.filter((r) => r.method === 'keyword').length;
          const tagged = skillResults.filter((r) => r.skills.length > 0).length;
          skillSummary = `  Skills inferred: ${tagged} task(s) tagged (${aiCount} AI, ${kwCount} keyword)`;

          const fallbackReasons = skillResults
            .filter((r) => r.fallbackReason)
            .map((r) => r.fallbackReason!);
          if (fallbackReasons.length > 0) {
            const uniqueReasons = [...new Set(fallbackReasons)];
            for (const reason of uniqueReasons.slice(0, 3)) {
              warnings.push(reason);
            }
          }
        }
      }

      await writeTasks(projectPath, finalTasks);

      // Count total tasks recursively
      const countAll = (tasks: typeof finalTasks): number =>
        tasks.reduce((sum, t) => sum + 1 + countAll(t.children), 0);

      // Summary output
      const topLevel = newTasks.length;
      const total = countAll(newTasks);
      console.log(chalk.green(`Parsed ${topLevel} top-level task(s) (${total} total) from ${file}`));
      console.log(chalk.dim(`  Parse method: ${parseMethod === 'ai' ? 'AI (Copilot)' : 'structural'}`));
      if (skillSummary) {
        console.log(chalk.dim(skillSummary));
      }
      if (opts.append && existingTasks.length > 0) {
        console.log(chalk.dim(`  Existing tasks: ${existingTasks.length} (unchanged)`));
        console.log(chalk.dim(`  New tasks appended: ${topLevel}`));
      }
      for (const w of warnings) {
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      let tasks = await readTasks(projectPath);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found. Run a parse command to generate tasks.'));
        return;
      }

      // --skills filter: include tasks matching ANY of the specified skills (OR logic)
      if (opts.skills) {
        const filterSkills = opts.skills.split(',').map((s) => s.trim()).filter(Boolean);
        if (filterSkills.length > 0) {
          tasks = tasks.filter((t) =>
            t.requiredSkills.some((s) => filterSkills.includes(s)),
          );
          if (tasks.length === 0) {
            console.log(chalk.yellow(`No tasks found matching skills: ${filterSkills.join(', ')}`));
            return;
          }
        }
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      setProjectPath(projectPath);
      const context = {
        tasks,
        filters: {
          status: opts.status,
          category: opts.category,
          type: opts.type,
        },
      };
      const output = renderToTerminal('task-list', context);
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const tasks = await readTasks(projectPath);

      const task = findTaskById(tasks, id);
      if (!task) {
        console.error(chalk.red(`Task "${id}" not found.`));
        process.exitCode = 1;
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(task, null, 2));
        return;
      }

      setProjectPath(projectPath);
      const output = renderToTerminal('task-detail', { task, withChildren: opts.withChildren });
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found. Run a parse command to generate tasks.'));
        return;
      }

      // Filter: top-level tasks only (not children)
      const scoreAll = opts.all || opts.recalculate;
      const tasksToScore = scoreAll
        ? tasks
        : tasks.filter((t) => t.complexity === 1);

      if (tasksToScore.length === 0) {
        console.log(chalk.yellow('No unscored tasks found. Use --all to re-score all tasks.'));
        return;
      }

      // Determine scorer: AI (auto-detect) or heuristic-only
      let providerLabel: string;
      let authAvailable = false;
      if (!opts.heuristicOnly) {
        const tokenSource = await resolveGitHubToken();
        authAvailable = tokenSource !== null;
      }
      const scorer = createScorer(config.ai.model, authAvailable);
      providerLabel = authAvailable
        ? `AI (${config.ai.model}) + heuristic blend`
        : 'heuristic (no AI authentication)';

      // Score
      const results = await Promise.all(
        tasksToScore.map((task) => scorer.scoreTask(task, tasks)),
      );

      console.log(chalk.dim(`Scored by: ${providerLabel}\n`));

      // Apply scores to task objects
      for (const result of results) {
        const task = findTaskById(tasks, result.taskId);
        if (task) {
          task.complexity = result.score;
        }
      }

      // Persist
      await writeTasks(projectPath, tasks);

      // JSON output
      if (opts.format === 'json') {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      // Build complexity report context
      const scoredTasks = results.map((r) => {
        const task = findTaskById(tasks, r.taskId);
        return task!;
      });

      const low = results.filter((r) => r.label === 'low').length;
      const medium = results.filter((r) => r.label === 'medium').length;
      const high = results.filter((r) => r.label === 'high').length;
      const average = results.length > 0
        ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / results.length) * 10) / 10
        : 0;

      const context: ComplexityReportContext = {
        tasks: scoredTasks,
        summary: { low, medium, high, average },
      };

      setProjectPath(projectPath);
      const output = renderToTerminal('complexity-report', context as unknown as Record<string, unknown>);
      console.log(output);

      // Threshold warnings
      const threshold = opts.threshold
        ? parseInt(opts.threshold, 10)
        : config.thresholds.flag;
      const flagged = results.filter((r) => r.score >= threshold);
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);

      const task = findTaskById(tasks, id);
      if (!task) {
        console.error(chalk.red(`Error: Task "${id}" not found.`));
        process.exitCode = 1;
        return;
      }

      // Check expandability: max depth
      const childType = getChildType(task.type, config.style);
      if (!childType) {
        console.error(
          chalk.red(
            `Cannot expand ${task.id}: already at maximum depth (${task.type}) for style '${config.style}'.`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      // Check already expanded
      if (task.children.length > 0 && !opts.force) {
        console.error(
          chalk.red(
            `Task ${task.id} already has ${task.children.length} subtask(s). Use --force to re-expand.`,
          ),
        );
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
      const tokenSource = await resolveGitHubToken();
      const authAvailable = tokenSource !== null;

      // Expand
      const result = await expandTask(task, config.style, {
        maxSubtasks: confirmResult.maxSubtasks,
        force: opts.force,
        statesConfig: config.states,
        model: config.ai.model,
        authAvailable,
      });

      if ('reason' in result) {
        console.error(chalk.red(result.reason));
        process.exitCode = 1;
        return;
      }

      // Apply children to the task
      task.children = result.children;
      await writeTasks(projectPath, tasks);

      // Summary
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found. Run a parse command first.'));
        return;
      }

      const threshold = opts.threshold
        ? parseInt(opts.threshold, 10)
        : config.thresholds.expand;

      // Filter eligible tasks
      const eligible = tasks.filter(
        (t) => t.complexity >= threshold && t.children.length === 0,
      );

      if (eligible.length === 0) {
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
          chalk.bold(`Would expand ${eligible.length} task(s) (threshold: ${threshold}):\n`),
        );
        for (const t of eligible) {
          const est = t.complexity <= 6 ? '~5' : `~${Math.min(10, t.complexity)}`;
          console.log(
            `  ${chalk.bold(t.id)}  ${chalk.dim(`"${t.title}"`)}  ` +
              `complexity: ${t.complexity}  -> ${est} subtasks`,
          );
        }
        return;
      }

      // Confirmation
      const bulkConfirm = await confirmBulkOperation(
        'Expand',
        eligible.length,
        { force: opts.force },
      );
      if (!bulkConfirm.confirmed) {
        console.log(chalk.dim('Expansion cancelled.'));
        return;
      }

      // Resolve auth
      const tokenSource = await resolveGitHubToken();
      const authAvailable = tokenSource !== null;

      // Batch expand
      const batchResult = await expandMultiple(tasks, config.style, threshold, {
        statesConfig: config.states,
        model: config.ai.model,
        authAvailable,
      });

      // Apply children to tasks in the array
      for (const result of batchResult.expanded) {
        const task = findTaskById(tasks, result.parentId);
        if (task) {
          task.children = result.children;
        }
      }

      await writeTasks(projectPath, tasks);

      // Summary
      if (batchResult.expanded.length > 0) {
        console.log(
          chalk.green(
            `Expanded ${batchResult.expanded.length} task(s):`,
          ),
        );
        for (const result of batchResult.expanded) {
          console.log(
            chalk.dim(`  ${result.parentId}: ${result.children.length} subtask(s)`),
          );
        }
      }

      if (batchResult.errors.length > 0) {
        console.log(chalk.yellow(`\n${batchResult.errors.length} task(s) skipped:`));
        for (const error of batchResult.errors) {
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const states = resolveStates(config.states);
      const tasks = await readTasks(projectPath);

      if (opts.force) {
        console.log(chalk.yellow('Warning: Transition rules bypassed with --force.'));
      }

      const result = executeSetStatus(tasks, id, newStatus, states, config.states.enforce_transitions, {
        cascade: opts.cascade,
        force: opts.force,
      });

      await writeTasks(projectPath, result.tasks);

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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);

      const addOpts: AddCommandOpts = {
        typeArg,
        title: opts.title,
        type: opts.type,
        priority: opts.priority,
        parent: opts.parent,
        skills: opts.skills,
      };

      const result = await executeAdd(tasks, config, addOpts);
      await writeTasks(projectPath, result.tasks);

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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const states = resolveStates(config.states);
      const tasks = await readTasks(projectPath);

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
      await writeTasks(projectPath, result.tasks);

      console.log(chalk.green(`Removed ${result.removedIds.length} task(s): ${result.removedIds.join(', ')}`));
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);
      const states = resolveStates(config.states);

      // Always recompute readiness for accurate reports
      const results = recomputeAllReadiness(tasks, states);
      applyReadiness(tasks, results);
      await writeTasks(projectPath, tasks);

      setProjectPath(projectPath);

      let context: Record<string, unknown>;
      let templateName: string;

      if (opts.template && !opts.type) {
        // Custom template pass-through
        const { flattenTasks } = await import('./readiness/dag.js');
        context = { tasks: flattenTasks(tasks) };
        templateName = opts.template;
      } else {
        // Built-in report type
        const validTypes = ['summary', 'complexity', 'progress', 'dependencies'];
        if (!validTypes.includes(opts.type)) {
          console.error(chalk.red(`Invalid report type "${opts.type}". Valid types: ${validTypes.join(', ')}`));
          process.exitCode = 1;
          return;
        }
        const reportType = opts.type as ReportType;
        context = aggregateReport(reportType, tasks, states);
        templateName = REPORT_TYPE_TO_TEMPLATE[reportType];
      }

      const format = opts.format as ReportFormat;
      switch (format) {
        case 'json':
          console.log(JSON.stringify(context, null, 2));
          break;
        case 'yaml':
          console.log(yaml.dump(context as Record<string, unknown>, { lineWidth: -1, noRefs: true }));
          break;
        case 'md':
          console.log(renderToMarkdown(templateName, context));
          break;
        case 'table':
        default:
          console.log(renderToTerminal(templateName, context));
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);
      const states = resolveStates(config.states);

      // Recompute and persist readiness
      const results = recomputeAllReadiness(tasks, states);
      applyReadiness(tasks, results);
      await writeTasks(projectPath, tasks);

      const next = findNextTask(tasks, states);

      if (!next) {
        console.log(chalk.yellow('No ready tasks found.'));
        return;
      }

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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);
      const states = resolveStates(config.states);

      // Recompute and persist readiness
      const results = recomputeAllReadiness(tasks, states);
      applyReadiness(tasks, results);
      await writeTasks(projectPath, tasks);

      const manifest = buildDelegationManifest(tasks, states);

      // Apply --skills filter (OR logic)
      if (opts.skills) {
        const filterSkills = opts.skills.split(',').map((s) => s.trim().toLowerCase());
        manifest.ready_tasks = manifest.ready_tasks.filter((t) =>
          t.required_skills.some((s) => filterSkills.includes(s.toLowerCase())),
        );
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(manifest, null, 2));
      } else if (opts.format === 'yaml') {
        console.log(yaml.dump(manifest, { lineWidth: -1, noRefs: true }));
      } else {
        // Table format (default)
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
        console.log(`  Total: ${manifest.summary.total}  Ready: ${manifest.summary.ready}  Blocked: ${manifest.summary.blocked}  In Progress: ${manifest.summary.in_progress}  Completed: ${manifest.summary.completed}`);
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const config = await loadProjectConfig(projectName);
      const tasks = await readTasks(projectPath);
      const states = resolveStates(config.states);
      const vocabulary = getEffectiveVocabulary(config.skills.vocabulary);

      const report = runValidation(tasks, states, vocabulary, !!opts.fix);

      // If fix was applied, persist the corrected tasks
      if (opts.fix && report.fixes && report.fixes.length > 0) {
        // Recompute readiness after fixes
        const results = recomputeAllReadiness(tasks, states);
        applyReadiness(tasks, results);
        await writeTasks(projectPath, tasks);

        console.log(chalk.bold.green(`\nFixes applied (${report.fixes.length}):`));
        for (const fix of report.fixes) {
          console.log(`  ${chalk.green('+')} [${fix.taskId}] ${fix.detail}`);
        }
      }

      // Report cycles
      if (report.cycles.hasCycle) {
        console.log(chalk.bold.red(`\nCycles detected:`));
        console.log(`  Nodes involved: ${report.cycles.cycleNodes.join(', ')}`);
      } else {
        console.log(chalk.green('\nNo cycles detected.'));
      }

      // Report dangling references
      if (report.danglingRefs.length > 0) {
        console.log(chalk.bold.red(`\nDangling references (${report.danglingRefs.length}):`));
        for (const ref of report.danglingRefs) {
          console.log(`  [${ref.taskId}] references non-existent task "${ref.referencedId}"`);
        }
      } else {
        console.log(chalk.green('No dangling references.'));
      }

      // Report skill issues
      if (report.skillIssues.length > 0) {
        console.log(chalk.bold.yellow(`\nSkill vocabulary issues (${report.skillIssues.length}):`));
        for (const issue of report.skillIssues) {
          const suggestion = issue.suggestion ? ` (did you mean "${issue.suggestion}"?)` : '';
          console.log(`  [${issue.taskId}] unknown skill "${issue.skill}"${suggestion}`);
        }
      } else {
        console.log(chalk.green('No skill vocabulary issues.'));
      }

      // Overall status
      if (report.isValid) {
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const tasks = await readTasks(projectPath);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found in tasks.json.'));
        return;
      }

      const files = await generateTaskFiles(projectPath, tasks);
      console.log(chalk.green(`Generated ${files.length} YAML task file(s) in tasks/.`));
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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const projectPath = getProjectDir(projectName);
      const result = await syncTaskFiles(projectPath, { dryRun: opts.dryRun });

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
      const projectName = await resolveProjectOrThrow(program.opts().project);
      const config = await loadProjectConfig(projectName);

      // --get key
      if (opts.get) {
        const value = getConfigValue(config, opts.get);
        if (value === null) {
          console.error(
            chalk.red(
              `Unknown config key "${opts.get}". Valid keys: ${CONFIG_KEYS.map((k) => k.key).join(', ')}`,
            ),
          );
          process.exitCode = 1;
          return;
        }
        console.log(value);
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
        const validation = validateConfigValue(key, value);
        if (!validation.valid) {
          console.error(chalk.red(`Error: ${validation.error}`));
          process.exitCode = 1;
          return;
        }
        const patch = applyConfigValue(key, value);
        await writeProjectConfig(projectName, patch);
        console.log(chalk.green(`Set ${key} = ${value}`));
        return;
      }

      // Interactive editor
      const result = await runConfigEditor(config);
      if (!result || !result.confirmed) {
        console.log(chalk.dim('No changes made.'));
        return;
      }
      const patch = applyConfigValue(result.key, result.value);
      await writeProjectConfig(projectName, patch);
      console.log(chalk.green(`Set ${result.key} = ${result.value}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

// --- auth (subcommands) ---
const auth = program
  .command('auth')
  .description('Authentication with GitHub Copilot');

auth
  .command('login')
  .description('Authenticate with GitHub Copilot via OAuth device flow')
  .action(async () => {
    try {
      await bootstrapHome();

      // Check if already authenticated
      const existing = await resolveGitHubToken();
      if (existing) {
        const creds = await readAuthCredentials();
        const user = creds?.username ?? 'unknown';
        console.log(chalk.yellow(`Already authenticated as @${user} (source: ${existing.source}).`));
        console.log(chalk.dim('Run "agentx-taskmaster auth logout" first to re-authenticate.'));
        return;
      }

      const result = await login();
      console.log(chalk.green(`\nAuthenticated as @${result.username}`));
      console.log(chalk.dim('  Token stored in ~/.agentx-userdata/taskmaster/auth.json'));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

auth
  .command('status')
  .description('Show authentication status and token validity')
  .option('--verbose', 'Show detailed token info')
  .action(async (opts: { verbose?: boolean }) => {
    try {
      await bootstrapHome();

      const tokenSource = await resolveGitHubToken();
      if (!tokenSource) {
        console.log(chalk.yellow('Not authenticated. Run "agentx-taskmaster auth login" to connect.'));
        return;
      }

      const creds = await readAuthCredentials();
      const username = creds?.username ?? 'unknown';

      console.log(chalk.green(`Authenticated as @${username}`));
      console.log(chalk.dim(`  Token source: ${tokenSource.source}`));

      if (opts.verbose) {
        if (creds?.copilot_token_expires_at) {
          const expiresAt = new Date(creds.copilot_token_expires_at * 1000);
          const now = new Date();
          const isValid = expiresAt > now;
          console.log(
            chalk.dim(`  Copilot token expires: ${expiresAt.toISOString()} (${isValid ? chalk.green('valid') : chalk.red('expired')})`),
          );
        } else {
          console.log(chalk.dim('  Copilot token: not cached (will be fetched on next API call)'));
        }

        // Show configured model from active project if available
        try {
          const projectName = await resolveProjectOrThrow(program.opts().project);
          const config = await loadProjectConfig(projectName);
          console.log(chalk.dim(`  Configured model: ${config.ai.model}`));
        } catch {
          console.log(chalk.dim('  Configured model: (no active project)'));
        }
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

auth
  .command('logout')
  .description('Revoke stored Copilot credentials')
  .action(async () => {
    try {
      await bootstrapHome();

      // Warn if token comes from env var
      const tokenSource = await resolveGitHubToken();
      if (tokenSource && tokenSource.source !== 'auth.json') {
        console.log(
          chalk.yellow(
            `Token is provided via environment variable (${tokenSource.source}). ` +
              'Unset the variable to fully log out.',
          ),
        );
      }

      await deleteAuthCredentials();
      console.log(chalk.green('Logged out. Credentials removed from auth.json.'));
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
  .description('List all projects with active marker')
  .action(async () => {
    try {
      await bootstrapHome();
      const registry = await readProjects();
      const projectList = registry.projects;

      if (projectList.length === 0) {
        console.log(chalk.yellow('No projects found. Run \'agentx-taskmaster projects create <name>\' to create one.'));
        return;
      }

      console.log(chalk.bold('\nProjects:\n'));
      for (const project of projectList) {
        const marker = project.name === registry.active ? chalk.green(' (active)') : '';
        console.log(`  ${chalk.bold(project.name)}${marker}`);
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
  .action(async (name: string, opts: { description?: string; style?: string }) => {
    try {
      await bootstrapHome();
      const entry = await createProject(name, opts.description ?? '');
      console.log(chalk.green(`\nProject "${entry.name}" created and set as active.`));
      console.log(chalk.dim(`  Directory: ~/.agentx-userdata/taskmaster/${entry.name}/`));
      console.log(chalk.dim(`  Config: config.yaml | Tasks: tasks.json`));
      console.log();
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

projects
  .command('switch <name>')
  .description('Set the active project')
  .action(async (name: string) => {
    try {
      await bootstrapHome();
      await switchProject(name);
      console.log(chalk.green(`Switched active project to "${name}".`));
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

      if (!opts.force) {
        console.log(chalk.yellow(`Warning: This will remove project "${name}" from the registry.`));
        console.log(chalk.yellow('Project data directory will NOT be deleted.'));
        console.log(chalk.yellow('Use --force to skip this warning.'));
        return;
      }

      await removeProject(name);
      console.log(chalk.green(`Project "${name}" removed from registry.`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

program.parse();
