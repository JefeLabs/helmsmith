import { Command } from 'commander';
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
  listAllProjects,
  switchProject,
  removeProject,
  readGlobalProjects,
} from './utils/projects.js';
import { resolveProjectOrThrow } from './config/resolver.js';
import { loadProjectConfig, writeProjectConfig } from './config/loader.js';
import { readTasks, writeTasks } from './formats/tasks-store.js';
import { generateTaskFiles } from './formats/task-writer.js';
import { syncTaskFiles } from './formats/sync.js';
import { detectGitRoot } from './utils/git.js';
import { ensureGitignoreEntry } from './utils/gitignore.js';
import type { ProjectLocation } from './utils/location.js';
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
import {
  login,
  resolveGitHubToken,
  readAuthCredentials,
  deleteAuthCredentials,
  callAI,
  resolveActiveAuth,
  getProvider,
  readAuthFile,
  writeAuthFile,
  AI_PROVIDERS,
} from './auth/index.js';
import type { AIProviderName } from './auth/index.js';
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
import { executeQAFail, executeQAFailBatch, type QAFailOpts, type QAFailBatchEntry } from './commands/qa-fail.js';
import { executeQAClear, executeQAClearBatch, type QAClearBatchEntry } from './commands/qa-clear.js';
import yaml from 'js-yaml';
import Table from 'cli-table3';

const program = new Command();

program
  .name(CLI_BIN_NAME)
  .description(CLI_DESCRIPTION)
  .version(CLI_VERSION)
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
  .option('--repo', 'Store project data in the current repository')
  .option('--no-interactive', 'Skip interactive prompts')
  .action(async (opts: { style?: string; name?: string; model?: string; repo?: boolean; interactive?: boolean }) => {
    try {
      await bootstrapHome();
      const gitRoot = await detectGitRoot();

      // Build flag overrides for --no-interactive
      const flagOverrides: Partial<InitWizardResult> = {};
      if (opts.name) flagOverrides.name = opts.name;
      if (opts.style) flagOverrides.style = opts.style as InitWizardResult['style'];
      if (opts.model) flagOverrides.model = opts.model;
      if (opts.repo) flagOverrides.location = 'repo';

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
        flagOverrides.provider = flagOverrides.provider ?? 'copilot' as AIProviderName;
        flagOverrides.model = flagOverrides.model ?? 'gpt-4.1';
        flagOverrides.thresholds = { expand: 5, flag: 8 };
        flagOverrides.location = flagOverrides.location ?? 'home';
        flagOverrides.gitignore = flagOverrides.location === 'repo';
      }

      const result = await runInitWizard(
        opts.interactive === false
          ? flagOverrides
          : { name: flagOverrides.name, style: flagOverrides.style, model: flagOverrides.model, location: flagOverrides.location },
        { gitRoot },
      );

      // Handle switch-to-existing
      if (result.switchTo) {
        await switchProject(result.switchTo, result.switchToLocation!, gitRoot);
        console.log(chalk.green(`Switched active project to "${result.switchTo}".`));
        return;
      }

      // Create project with wizard config
      const projectConfig = {
        style: result.style,
        states: { preset: result.statePreset, enforce_transitions: false },
        skills: { vocabulary: result.skills, auto_infer: true },
        ai: { provider: result.provider ?? 'copilot', model: result.model },
        thresholds: result.thresholds,
      };

      if (result.location === 'repo' && gitRoot) {
        await bootstrapRepoHome(gitRoot);
      }

      await createProject(result.name, result.location, gitRoot, result.description, projectConfig);

      if (result.location === 'repo' && result.gitignore && gitRoot) {
        await ensureGitignoreEntry(gitRoot);
      }

      // Save to defaults.yaml (last-used-wins)
      await writeDefaults({
        provider: result.provider,
        model: result.model,
        style: result.style,
        statusPreset: result.statePreset,
        skills: result.skills,
        thresholds: result.thresholds,
      });

      const locationLabel = result.location === 'repo' ? ' [repo]' : ' [home]';
      console.log(chalk.green(`\nProject "${result.name}"${locationLabel} created and set as active.`));
      console.log(chalk.dim(`  Style: ${result.style} | Status preset: ${result.statePreset}`));
      console.log(chalk.dim(`  Model: ${result.model}`));
      console.log(chalk.dim(`  Skills: ${result.skills.join(', ')}`));
      console.log(chalk.dim(`  Thresholds: expand=${result.thresholds.expand}, flag=${result.thresholds.flag}`));
      if (result.location === 'repo' && result.gitignore) {
        console.log(chalk.dim(`  .agentx/ added to .gitignore`));
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

      const { runScanPipeline } = await import('./parser/analysis/scanner.js');
      const result = await runScanPipeline(rootPath);

      // Persist indexes to repo home
      const repoHome = gitRoot
        ? (await import('./utils/git.js')).getRepoTaskmasterHome(gitRoot)
        : null;

      if (repoHome) {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(repoHome, { recursive: true });

        const { writeComponentIndex, writeSymbolIndex } = await import('./formats/index-store.js');
        await writeComponentIndex(repoHome, result.componentIndex);
        await writeSymbolIndex(repoHome, result.symbolIndex);
        console.log(chalk.dim(`\n  Indexes persisted to ${repoHome}`));
      } else {
        console.log(chalk.yellow('\n  Not inside a git repository — indexes not persisted.'));
      }

      // Summary
      console.log(chalk.green('\nScan complete:'));
      console.log(chalk.dim(`  Files: ${result.scanResult.totalFiles}`));
      console.log(chalk.dim(`  Directories: ${result.scanResult.totalDirectories}`));
      console.log(chalk.dim(`  Components: ${result.components.length}`));
      console.log(chalk.dim(`  Symbols: ${result.symbolIndex.entries.reduce((sum, e) => sum + e.symbols.length, 0)}`));
      console.log(chalk.dim(`  Layers: ${[...new Set(result.symbolIndex.entries.map(e => e.layer))].join(', ') || 'none'}`));
      if (result.scanResult.detectedPatterns.length > 0) {
        console.log(chalk.dim(`  Patterns: ${result.scanResult.detectedPatterns.join(', ')}`));
      }
      for (const w of result.warnings) {
        console.log(chalk.yellow(`  Warning: ${w}`));
      }

      // Blueprint auto-detection
      try {
        const { detectBlueprints } = await import('./blueprints/index.js');
        const detections = detectBlueprints(result.scanResult, result.components);
        if (detections.length > 0) {
          console.log(chalk.bold('\n  Detected archetypes:'));
          for (const d of detections.slice(0, 5)) {
            const pct = Math.round(d.confidence * 100);
            console.log(chalk.dim(`    ${d.blueprintId} (${pct}%) — ${d.matchedSignals.join(', ')}`));
          }
        }
      } catch {
        // Blueprint detection is best-effort
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

      const style = opts.style ?? config.style;
      const defaultStatus = getDefaultStatus(config.states);
      const parseOptions = {
        style,
        defaultStatus,
        numTasks: opts.numTasks ? parseInt(opts.numTasks, 10) : undefined,
      };

      let parsedTasks: import('./config/schema.js').TaskNode[];
      let parseMethod: 'ai-architecture' | 'ai' | 'structural';
      const warnings: string[] = [];
      let analysisJson: unknown = null;

      // Try AI parsing first (unless --no-ai)
      const useAI = opts.ai !== false;
      if (useAI) {
        const authResult = await resolveActiveAuth(config.ai.provider);
        if (authResult) {
          // Default: architecture pipeline (Phase 1 + Phase 2)
          try {
            console.log(chalk.dim(`  Architecture pipeline (${config.ai.provider})...`));
            const { parseWithArchitecturePipeline } = await import('./parser/ai-parser.js');
            const pipelineResult = await parseWithArchitecturePipeline(
              content,
              config.ai.model,
              parseOptions,
              config.ai.provider,
              {
                codebasePath: gitRoot,
                skipScan: opts.scan === false,
                blueprintId: config.blueprint.id,
                blueprintAnswers: config.blueprint.contextAnswers,
              },
            );
            if (pipelineResult && pipelineResult.tasks.length > 0) {
              parsedTasks = pipelineResult.tasks;
              parseMethod = 'ai-architecture';
              warnings.push(...pipelineResult.warnings);
              analysisJson = pipelineResult.analysis;
            } else {
              console.log(chalk.yellow('  Architecture pipeline returned no tasks, falling back to single-shot AI.'));
              parsedTasks = null!;
              parseMethod = 'ai';
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.log(chalk.yellow(`  Architecture pipeline failed: ${message}`));
            console.log(chalk.yellow('  Falling back to single-shot AI parser.'));
            parsedTasks = null!;
            parseMethod = 'ai';
          }

          // Fallback: single-shot AI (legacy)
          if (!parsedTasks) {
            try {
              console.log(chalk.dim(`  Single-shot AI (${config.ai.provider})...`));
              const { parseWithAI } = await import('./parser/ai-parser.js');
              const aiResult = await parseWithAI(content, config.ai.model, parseOptions, config.ai.provider);
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
          }
        } else {
          console.log(chalk.dim(`  No ${config.ai.provider} auth found, using structural parser.`));
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
      if (parseMethod === 'ai-architecture' || parseMethod === 'ai') {
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

      await writeTasks(resolved.projectDir, finalTasks);

      // Persist analysis.json alongside tasks.json (architecture pipeline only)
      if (analysisJson) {
        const { writeFile } = await import('node:fs/promises');
        const analysisPath = resolve(resolved.projectDir, 'analysis.json');
        await writeFile(analysisPath, JSON.stringify(analysisJson, null, 2) + '\n');
        console.log(chalk.dim(`  Architecture analysis saved to analysis.json`));
      }

      // Count total tasks recursively
      const countAll = (tasks: typeof finalTasks): number =>
        tasks.reduce((sum, t) => sum + 1 + countAll(t.children), 0);

      // Summary output
      const topLevel = newTasks.length;
      const total = countAll(newTasks);
      console.log(chalk.green(`Parsed ${topLevel} top-level task(s) (${total} total) from ${file}`));
      const methodLabel = parseMethod === 'ai-architecture'
        ? `AI architecture pipeline (${config.ai.provider})`
        : parseMethod === 'ai'
          ? `AI single-shot (${config.ai.provider})`
          : 'structural';
      console.log(chalk.dim(`  Parse method: ${methodLabel}`));
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
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      let tasks = await readTasks(resolved.projectDir);

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

      setProjectPath(resolved.projectDir);
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
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const tasks = await readTasks(resolved.projectDir);

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

      setProjectPath(resolved.projectDir);
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
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);

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
        const authResult = await resolveActiveAuth(config.ai.provider);
        authAvailable = authResult !== null;
      }
      const scorer = createScorer(config.ai.model, authAvailable, config.ai.provider);
      providerLabel = authAvailable
        ? `AI (${config.ai.provider}/${config.ai.model}) + heuristic blend`
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
      await writeTasks(resolved.projectDir, tasks);

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

      setProjectPath(resolved.projectDir);
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
      const authResult = await resolveActiveAuth(config.ai.provider);
      const authAvailable = authResult !== null;

      // Expand
      const result = await expandTask(task, config.style, {
        maxSubtasks: confirmResult.maxSubtasks,
        force: opts.force,
        statesConfig: config.states,
        model: config.ai.model,
        authAvailable,
        provider: config.ai.provider,
      });

      if ('reason' in result) {
        console.error(chalk.red(result.reason));
        process.exitCode = 1;
        return;
      }

      // Apply children to the task
      task.children = result.children;
      await writeTasks(resolved.projectDir, tasks);

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
      const authResult = await resolveActiveAuth(config.ai.provider);
      const authAvailable = authResult !== null;

      // Batch expand
      const batchResult = await expandMultiple(tasks, config.style, threshold, {
        statesConfig: config.states,
        model: config.ai.model,
        authAvailable,
        provider: config.ai.provider,
      });

      // Apply children to tasks in the array
      for (const result of batchResult.expanded) {
        const task = findTaskById(tasks, result.parentId);
        if (task) {
          task.children = result.children;
        }
      }

      await writeTasks(resolved.projectDir, tasks);

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

      // Always recompute readiness for accurate reports
      const results = recomputeAllReadiness(tasks, states);
      applyReadiness(tasks, results);
      await writeTasks(resolved.projectDir, tasks);

      setProjectPath(resolved.projectDir);

      let context: Record<string, unknown>;
      let templateName: string;

      if (opts.template && !opts.type) {
        // Custom template pass-through
        const { flattenTasks } = await import('./readiness/dag.js');
        context = { tasks: flattenTasks(tasks) };
        templateName = opts.template;
      } else {
        // Built-in report type
        const validTypes = ['summary', 'complexity', 'progress', 'dependencies', 'qa'];
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
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);
      const states = resolveStates(config.states);

      // Recompute and persist readiness
      const results = recomputeAllReadiness(tasks, states);
      applyReadiness(tasks, results);
      await writeTasks(resolved.projectDir, tasks);

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
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const config = await loadProjectConfig(resolved.projectDir);
      const tasks = await readTasks(resolved.projectDir);
      const states = resolveStates(config.states);

      // Recompute and persist readiness
      const results = recomputeAllReadiness(tasks, states);
      applyReadiness(tasks, results);
      await writeTasks(resolved.projectDir, tasks);

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
        // Table format (default) — QA failures first for visibility
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

      const report = runValidation(tasks, states, vocabulary, !!opts.fix);

      // If fix was applied, persist the corrected tasks
      if (opts.fix && report.fixes && report.fixes.length > 0) {
        // Recompute readiness after fixes
        const results = recomputeAllReadiness(tasks, states);
        applyReadiness(tasks, results);
        await writeTasks(resolved.projectDir, tasks);

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
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const tasks = await readTasks(resolved.projectDir);

      if (tasks.length === 0) {
        console.log(chalk.yellow('No tasks found in tasks.json.'));
        return;
      }

      const files = await generateTaskFiles(resolved.projectDir, tasks);
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
      const gitRoot = await detectGitRoot();
      const resolved = await resolveProjectOrThrow(program.opts().project, gitRoot);
      const result = await syncTaskFiles(resolved.projectDir, { dryRun: opts.dryRun });

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
        await writeProjectConfig(resolved.projectDir, patch);
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
      await writeProjectConfig(resolved.projectDir, patch);
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
        // Interactive provider selection
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

      const provider = getProvider(providerName);

      // Check if already authenticated for this provider (unless --force)
      if (!opts.force) {
        const existing = await provider.resolveAuth();
        if (existing && (existing.source.startsWith('auth.json') || existing.source.startsWith('env:'))) {
          console.log(chalk.yellow(`Already authenticated with ${providerName} (source: ${existing!.source}).`));
          console.log(chalk.dim(`Run "${CLI_BIN_NAME} auth login --provider ${providerName} --force" to re-authenticate.`));
          return;
        }
      }

      const result = await provider.login({ force: opts.force });
      console.log(chalk.green(`\nAuthenticated with ${providerName} as ${result.displayName}`));
      console.log(chalk.dim(`  Credentials stored in ${APP_CONFIG_DIR_DISPLAY}/auth.json`));

      // Set as active provider
      const authFile = await readAuthFile();
      authFile.active_provider = providerName;
      await writeAuthFile(authFile);
      console.log(chalk.dim(`  Active provider set to: ${providerName}`));
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

      const authFile = await readAuthFile();
      console.log(chalk.bold(`Active provider: ${authFile.active_provider}\n`));

      let anyAuth = false;
      for (const name of AI_PROVIDERS) {
        const provider = getProvider(name);
        const authResult = await provider.resolveAuth();
        const marker = name === authFile.active_provider ? chalk.green(' (active)') : '';

        if (authResult) {
          anyAuth = true;
          const displayName = name === 'copilot'
            ? authFile.copilot?.username ? `@${authFile.copilot.username}` : 'authenticated'
            : authFile[name]?.display_name ?? 'authenticated';
          console.log(`  ${chalk.bold(name)}${marker}: ${chalk.green(displayName)} (${authResult.source})`);
        } else {
          console.log(`  ${chalk.bold(name)}${marker}: ${chalk.dim('not authenticated')}`);
        }
      }

      if (!anyAuth) {
        console.log(chalk.yellow(`\nNo providers authenticated. Run "${CLI_BIN_NAME} auth login" to connect.`));
      }

      if (opts.verbose) {
        // Show configured model from active project if available
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

      if (!AI_PROVIDERS.includes(providerArg as AIProviderName)) {
        console.error(chalk.red(`Unknown provider "${providerArg}". Valid: ${AI_PROVIDERS.join(', ')}`));
        process.exitCode = 1;
        return;
      }

      const providerName = providerArg as AIProviderName;
      const provider = getProvider(providerName);
      const authResult = await provider.resolveAuth();

      if (!authResult) {
        console.error(
          chalk.red(
            `Not authenticated with ${providerName}. Run "${CLI_BIN_NAME} auth login --provider ${providerName}" first.`,
          ),
        );
        process.exitCode = 1;
        return;
      }

      const authFile = await readAuthFile();
      authFile.active_provider = providerName;
      await writeAuthFile(authFile);
      console.log(chalk.green(`Switched active provider to ${providerName}.`));
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

      const authFile = await readAuthFile();
      const providerName = (opts.provider ?? authFile.active_provider) as AIProviderName;

      if (!AI_PROVIDERS.includes(providerName)) {
        console.error(chalk.red(`Unknown provider "${providerName}". Valid: ${AI_PROVIDERS.join(', ')}`));
        process.exitCode = 1;
        return;
      }

      // Warn if Copilot token comes from env var
      if (providerName === 'copilot') {
        const tokenSource = await resolveGitHubToken();
        if (tokenSource && tokenSource.source !== 'auth.json') {
          console.log(
            chalk.yellow(
              `Token is provided via environment variable (${tokenSource.source}). ` +
                'Unset the variable to fully log out.',
            ),
          );
        }
      }

      const provider = getProvider(providerName);
      await provider.logout();
      console.log(chalk.green(`Logged out from ${providerName}. Credentials removed.`));
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
      const all = await listAllProjects(gitRoot);

      if (all.projects.length === 0) {
        console.log(chalk.yellow(`No projects found. Run '${CLI_BIN_NAME} projects create <name>' to create one.`));
        return;
      }

      console.log(chalk.bold('\nProjects:\n'));
      for (const project of all.projects) {
        const isActive = project.name === all.active && project.location === all.activeLocation;
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

      const entry = await createProject(name, location, gitRoot, opts.description ?? '');
      const locationTag = location === 'repo' ? ' [repo]' : ' [home]';
      const displayDir = location === 'repo' ? APP_REPO_CONFIG_DIR_DISPLAY : APP_CONFIG_DIR_DISPLAY;
      console.log(chalk.green(`\nProject "${entry.name}"${locationTag} created and set as active.`));
      console.log(chalk.dim(`  Directory: ${displayDir}/${entry.name}/`));
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

      // Search repo first, then home
      let found = false;
      if (gitRoot) {
        const repo = await import('./utils/projects.js').then((m) => m.readRepoProjects(gitRoot));
        if (repo.projects.some((p) => p.name === name)) {
          await switchProject(name, 'repo', gitRoot);
          console.log(chalk.green(`Switched active project to "${name}" [repo].`));
          found = true;
        }
      }

      if (!found) {
        await switchProject(name, 'home');
        console.log(chalk.green(`Switched active project to "${name}" [home].`));
      }
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

      // Search repo first, then home
      let removed = false;
      if (gitRoot) {
        const { readRepoProjects } = await import('./utils/projects.js');
        const repo = await readRepoProjects(gitRoot);
        if (repo.projects.some((p) => p.name === name)) {
          await removeProject(name, 'repo', gitRoot);
          console.log(chalk.green(`Project "${name}" [repo] removed from registry.`));
          removed = true;
        }
      }

      if (!removed) {
        await removeProject(name, 'home', null);
        console.log(chalk.green(`Project "${name}" [home] removed from registry.`));
      }
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

      const { getBlueprint, resolveBlueprint, generateConcernTasks, BLUEPRINT_IDS } =
        await import('./blueprints/index.js');
      const bp = getBlueprint(id);

      if (!bp) {
        console.error(chalk.red(`Blueprint "${id}" not found. Available: ${BLUEPRINT_IDS.join(', ')}`));
        process.exitCode = 1;
        return;
      }

      // Gather context answers
      let contextAnswers: Record<string, string | boolean | string[]>;
      if (opts.answers) {
        contextAnswers = JSON.parse(opts.answers);
      } else if (opts.interactive === false) {
        // Use question defaults
        contextAnswers = {};
        for (const q of bp.contextQuestions) {
          if (q.default !== undefined) {
            contextAnswers[q.id] = q.default;
          }
        }
      } else {
        const { runBlueprintQuestions } = await import('./prompts/blueprint-questions.js');
        contextAnswers = await runBlueprintQuestions(bp.contextQuestions);
      }

      // Resolve concerns based on answers
      const concerns = resolveBlueprint(bp, contextAnswers);

      // Generate tasks
      const existingTasks = await readTasks(resolved.projectDir);
      const startId = existingTasks.length > 0 ? getNextId(existingTasks) : 1;
      const defaultStatus = getDefaultStatus(config.states);

      const newTasks = generateConcernTasks(concerns, {
        blueprintId: id,
        style: opts.flat ? 'flat' : 'grouped',
        defaultStatus,
        startId,
      });

      // Append to existing tasks
      const finalTasks = [...existingTasks, ...newTasks];
      await writeTasks(resolved.projectDir, finalTasks);

      // Persist blueprint selection to config
      await writeProjectConfig(resolved.projectDir, {
        blueprint: { id, contextAnswers },
      });

      // Summary
      const countAll = (tasks: typeof newTasks): number =>
        tasks.reduce((sum, t) => sum + 1 + countAll(t.children), 0);
      const total = countAll(newTasks);

      console.log(chalk.green(`Applied blueprint "${bp.name}" — ${newTasks.length} top-level task(s) (${total} total)`));
      console.log(chalk.dim(`  Blueprint: ${id}`));
      console.log(chalk.dim(`  Concerns resolved: ${concerns.length}`));
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

      const { getBlueprint, resolveBlueprint, groupByUrgency } =
        await import('./blueprints/index.js');
      const bp = getBlueprint(config.blueprint.id);

      if (!bp) {
        console.error(chalk.red(`Blueprint "${config.blueprint.id}" not found.`));
        process.exitCode = 1;
        return;
      }

      const concerns = resolveBlueprint(bp, config.blueprint.contextAnswers);
      const tasks = await readTasks(resolved.projectDir);

      // Build tag set from all tasks (recursive)
      const taskTags = new Set<string>();
      const collectTags = (nodes: typeof tasks) => {
        for (const t of nodes) {
          for (const tag of t.tags) taskTags.add(tag);
          collectTags(t.children);
        }
      };
      collectTags(tasks);

      // Check each concern for coverage
      const concernStatuses = concerns.map((c) => {
        const blueprintTag = `blueprint:${config.blueprint.id}`;
        const concernTag = `concern:${c.category}`;

        // A concern is covered if any task has both the blueprint tag and concern tag
        const present = taskTags.has(blueprintTag) && taskTags.has(concernTag);

        let status: string;
        if (present) {
          status = '\u2713 present';
        } else if (c.urgency === 'deferred') {
          status = '\u2014 (not required yet)';
        } else {
          status = '\u2717 missing';
        }

        return {
          title: c.title,
          urgency: c.urgency,
          status,
          isMissing: !present && c.urgency !== 'deferred',
        };
      });

      const groups = groupByUrgency(concerns);
      const missingUpfront = concernStatuses
        .filter((c) => c.isMissing && c.urgency === 'upfront')
        .map((c) => c.title);

      const coveredCount = concernStatuses.filter((c) => c.status.startsWith('\u2713')).length;

      setProjectPath(resolved.projectDir);
      const output = renderToTerminal('blueprint-check', {
        blueprint: bp,
        concerns: concernStatuses,
        coveredCount,
        totalCount: concerns.length,
        missingUpfront,
      });
      console.log(output);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

program.parse();
