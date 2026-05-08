import type { TaskNode, ProjectConfig } from '../config/schema.js';
import { getDefaultStatus } from '../config/state-engine.js';
import { parsePlan, getNextId, renumberTasks } from '../parser/index.js';
import { inferSkills } from '../skills/index.js';
import { resolveActiveAuth } from '../auth/index.js';

export interface ParseOpts {
  numTasks?: string;
  style?: string;
  append?: boolean;
  force?: boolean;
  ai?: boolean;
  scan?: boolean;
}

export interface ParseResult {
  finalTasks: TaskNode[];
  newTasks: TaskNode[];
  topLevel: number;
  total: number;
  parseMethod: 'ai-architecture' | 'ai' | 'structural';
  skillSummary: string;
  warnings: string[];
  analysisJson: unknown;
}

/**
 * Count all tasks recursively including children.
 */
function countAll(tasks: TaskNode[]): number {
  return tasks.reduce((sum, t) => sum + 1 + countAll(t.children), 0);
}

/**
 * Execute the parse command: parse an implementation plan using AI pipeline
 * with structural fallback, apply skill inference, and produce a task tree.
 *
 * Progress messages are emitted via the optional `onProgress` callback.
 */
export async function executeParse(
  content: string,
  fileName: string,
  existingTasks: TaskNode[],
  config: ProjectConfig,
  opts: ParseOpts = {},
  onProgress?: (message: string) => void,
): Promise<ParseResult> {
  const style = opts.style ?? config.style;
  const defaultStatus = getDefaultStatus(config.states);
  const parseOptions = {
    style,
    defaultStatus,
    numTasks: opts.numTasks ? parseInt(opts.numTasks, 10) : undefined,
  };

  let parsedTasks: TaskNode[] = null!;
  let parseMethod: ParseResult['parseMethod'] = 'structural';
  const warnings: string[] = [];
  let analysisJson: unknown = null;

  const log = onProgress ?? (() => {});

  // Try AI parsing first (unless --no-ai)
  const useAI = opts.ai !== false;
  if (useAI) {
    const authResult = await resolveActiveAuth(config.ai.provider);
    if (authResult) {
      // Architecture pipeline (Phase 1 + Phase 2)
      try {
        log(`Architecture pipeline (${config.ai.provider})...`);
        const { parseWithArchitecturePipeline } = await import('../parser/ai-parser.js');
        const pipelineResult = await parseWithArchitecturePipeline(
          content,
          config.ai.model,
          parseOptions,
          config.ai.provider,
          {
            codebasePath: undefined,
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
          log('Architecture pipeline returned no tasks, falling back to single-shot AI.');
          parseMethod = 'ai';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Architecture pipeline failed: ${message}`);
        log('Falling back to single-shot AI parser.');
        parseMethod = 'ai';
      }

      // Fallback: single-shot AI (legacy)
      if (!parsedTasks) {
        try {
          log(`Single-shot AI (${config.ai.provider})...`);
          const { parseWithAI } = await import('../parser/ai-parser.js');
          const aiResult = await parseWithAI(content, config.ai.model, parseOptions, config.ai.provider);
          if (aiResult && aiResult.tasks.length > 0) {
            parsedTasks = aiResult.tasks;
            parseMethod = 'ai';
            if (aiResult.warning) {
              warnings.push(aiResult.warning);
            }
          } else {
            log('AI returned no tasks, falling back to structural parser.');
            parseMethod = 'structural';
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log(`AI parsing failed: ${message}`);
          log('Falling back to structural parser.');
          parseMethod = 'structural';
        }
      }
    } else {
      log(`No ${config.ai.provider} auth found, using structural parser.`);
      parseMethod = 'structural';
    }
  }

  // Structural fallback
  if (parseMethod === 'structural' || !parsedTasks) {
    const result = await parsePlan(content, fileName, parseOptions);
    parsedTasks = result.tasks;
    parseMethod = 'structural';
    warnings.push(...result.warnings);
  }

  // Append or replace
  let finalTasks: TaskNode[];
  let newTasks: TaskNode[];
  if (opts.append && existingTasks.length > 0) {
    const startId = getNextId(existingTasks);
    const renumbered = renumberTasks(parsedTasks, startId);
    newTasks = renumbered;
    finalTasks = [...existingTasks, ...renumbered];
  } else {
    newTasks = parsedTasks;
    finalTasks = parsedTasks;
  }

  // Skill inference
  let skillSummary = '';
  if (parseMethod === 'ai-architecture' || parseMethod === 'ai') {
    const countWithSkills = (tasks: TaskNode[]): number =>
      tasks.reduce((sum, t) => sum + (t.requiredSkills.length > 0 ? 1 : 0) + countWithSkills(t.children), 0);
    const tagged = countWithSkills(newTasks);
    if (tagged > 0) {
      skillSummary = `Skills: ${tagged} task(s) tagged by AI`;
    }
  } else {
    const skillResults = await inferSkills(newTasks, config);
    if (skillResults.length > 0) {
      const aiCount = skillResults.filter((r) => r.method === 'ai').length;
      const kwCount = skillResults.filter((r) => r.method === 'keyword').length;
      const tagged = skillResults.filter((r) => r.skills.length > 0).length;
      skillSummary = `Skills inferred: ${tagged} task(s) tagged (${aiCount} AI, ${kwCount} keyword)`;

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

  return {
    finalTasks,
    newTasks,
    topLevel: newTasks.length,
    total: countAll(newTasks),
    parseMethod,
    skillSummary,
    warnings,
    analysisJson,
  };
}
