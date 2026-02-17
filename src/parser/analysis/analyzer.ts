import chalk from 'chalk';
import type { TaskNode } from '../../config/schema.js';
import { PROJECT_STYLES } from '../../config/styles.js';
import { callAI } from '../../auth/call-ai.js';
import { formatComponentIndexForPrompt } from './retrieval.js';
import { buildArchitectureDiscoveryPrompt, buildTaskGenerationPrompt } from './prompts.js';
import { runScanPipeline } from './scanner.js';
import {
  ArchitectureAnalysisSchema,
  Phase2ResponseSchema,
} from './types.js';
import type {
  ArchitectureAnalysis,
  AITaskWithTags,
  AnalysisPipelineOptions,
  AnalysisPipelineResult,
} from './types.js';

/**
 * Strip markdown code fences from AI response.
 */
function stripCodeFences(content: string): string {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned;
}

/**
 * Parse and validate the Phase 1 AI response as ArchitectureAnalysis.
 */
function parsePhase1Response(content: string): ArchitectureAnalysis {
  const cleaned = stripCodeFences(content);
  const parsed = JSON.parse(cleaned);
  return ArchitectureAnalysisSchema.parse(parsed);
}

/**
 * Parse the Phase 2 AI response as a task array.
 */
function parsePhase2Response(content: string): AITaskWithTags[] {
  const cleaned = stripCodeFences(content);
  const parsed = JSON.parse(cleaned);
  const result = Phase2ResponseSchema.parse(parsed);
  return result.tasks;
}

/**
 * Convert an AITaskWithTags into a full TaskNode with IDs and defaults.
 */
function aiTaskToNode(
  aiTask: AITaskWithTags,
  parentId: string,
  index: number,
  defaultStatus: string,
  validTypes: string[],
): TaskNode {
  const id = parentId ? `${parentId}.${index}` : `${index}`;

  const type = validTypes.includes(aiTask.type)
    ? (aiTask.type as TaskNode['type'])
    : (validTypes[validTypes.length - 1] as TaskNode['type']);

  const priority = ['critical', 'high', 'medium', 'low'].includes(aiTask.priority)
    ? (aiTask.priority as TaskNode['priority'])
    : 'medium';

  const children = (aiTask.children ?? []).map((child, i) =>
    aiTaskToNode(child, id, i + 1, defaultStatus, validTypes),
  );

  return {
    id,
    title: aiTask.title || 'Untitled',
    description: aiTask.description || '',
    type,
    status: defaultStatus,
    complexity: 1,
    priority,
    requiredSkills: Array.isArray(aiTask.requiredSkills) ? aiTask.requiredSkills : [],
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: Array.isArray(aiTask.tags) ? aiTask.tags : [],
    qaFeedback: [],
    children,
    metadata: {
      source: 'ai-architecture',
      autoExpanded: false,
      skillsInferred: true,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Build a title→ID lookup map from a task tree (all levels).
 */
function buildTitleMap(tasks: TaskNode[]): Map<string, string> {
  const map = new Map<string, string>();

  function walk(nodes: TaskNode[]): void {
    for (const node of nodes) {
      map.set(node.title.toLowerCase(), node.id);
      walk(node.children);
    }
  }

  walk(tasks);
  return map;
}

/**
 * Resolve title-based dependencies to ID-based dependencies.
 * Walks both the TaskNode tree and the AITask tree in parallel.
 */
function resolveDependencies(
  tasks: TaskNode[],
  aiTasks: AITaskWithTags[],
  titleMap: Map<string, string>,
): void {
  function resolve(nodes: TaskNode[], aiNodes: AITaskWithTags[]): void {
    for (let i = 0; i < nodes.length && i < aiNodes.length; i++) {
      const deps = aiNodes[i].dependencies ?? [];
      for (const depTitle of deps) {
        const depId = titleMap.get(depTitle.toLowerCase());
        if (depId && depId !== nodes[i].id) {
          // Avoid duplicate dependency entries
          if (!nodes[i].dependencies.some(d => d.taskId === depId)) {
            nodes[i].dependencies.push({ taskId: depId, type: 'blocks' });
          }
        }
      }
      if (nodes[i].children.length > 0 && aiNodes[i].children) {
        resolve(nodes[i].children, aiNodes[i].children);
      }
    }
  }

  resolve(tasks, aiTasks);
}

/**
 * Infer additional dependencies from interface relationships.
 * For each interface {from: A, to: B}, A's top-level task depends on B's.
 */
function inferInterfaceDependencies(
  tasks: TaskNode[],
  analysis: ArchitectureAnalysis,
): void {
  // Build component-name → task-id map (top-level tasks tagged with component:<name>)
  const componentToTask = new Map<string, string>();
  for (const task of tasks) {
    for (const tag of task.tags) {
      if (tag.startsWith('component:')) {
        componentToTask.set(tag.replace('component:', ''), task.id);
      }
    }
  }

  for (const iface of analysis.interfaces) {
    const fromTaskId = componentToTask.get(iface.from);
    const toTaskId = componentToTask.get(iface.to);

    if (fromTaskId && toTaskId && fromTaskId !== toTaskId) {
      const fromTask = tasks.find(t => t.id === fromTaskId);
      if (fromTask && !fromTask.dependencies.some(d => d.taskId === toTaskId)) {
        fromTask.dependencies.push({ taskId: toTaskId, type: 'blocks' });
      }
    }
  }
}

/**
 * Run the full architecture analysis pipeline.
 *
 * 1. Codebase scan (optional, if codebasePath provided and not skipped)
 * 2. Source analysis (optional, tree-sitter)
 * 3. Phase 1 AI call: Architecture Discovery
 * 4. Phase 2 AI call: Task Generation
 * 5. Hydrate TaskNodes, resolve dependencies
 */
export async function runAnalysisPipeline(
  documentContent: string,
  options: AnalysisPipelineOptions,
): Promise<AnalysisPipelineResult> {
  const warnings: string[] = [];

  // --- Steps 0–2.5: Scan pipeline (component discovery, codebase scan, source analysis, indexes) ---
  let scanResult = null;
  let sourceResult = null;
  let componentIndex = undefined;
  let symbolIndex = undefined;
  let componentIndexSummary: string | null = null;

  if (options.codebasePath && !options.skipScan) {
    try {
      const scan = await runScanPipeline(options.codebasePath);
      scanResult = scan.scanResult;
      sourceResult = scan.sourceResult;
      componentIndex = scan.componentIndex;
      symbolIndex = scan.symbolIndex;
      warnings.push(...scan.warnings);

      if (scan.components.length > 0) {
        componentIndexSummary = formatComponentIndexForPrompt(componentIndex);
      }
    } catch (err) {
      warnings.push(`Scan pipeline failed: ${(err as Error).message}`);
    }
  }

  // --- Step 3: Phase 1 — Architecture Discovery ---
  console.error(chalk.dim('  Phase 1: Architecture discovery...'));
  const phase1Messages = buildArchitectureDiscoveryPrompt(documentContent, scanResult, sourceResult, componentIndexSummary);
  const phase1Response = await callAI(phase1Messages, options.model, options.provider, 'parser-analysis');
  const phase1Content = phase1Response.choices?.[0]?.message?.content;

  if (!phase1Content) {
    throw new Error('Phase 1 AI returned empty response');
  }

  let analysis: ArchitectureAnalysis;
  try {
    analysis = parsePhase1Response(phase1Content);
  } catch (err) {
    throw new Error(`Phase 1 response failed validation: ${(err as Error).message}`);
  }

  console.error(
    chalk.dim(
      `  Architecture: ${analysis.components.length} components, ` +
      `${analysis.interfaces.length} interfaces, ` +
      `${analysis.dataSources.length} data sources`,
    ),
  );

  // --- Step 3.5: Load blueprint context (if configured) ---
  let blueprintOption: Parameters<typeof buildTaskGenerationPrompt>[2]['blueprint'] = undefined;
  if (options.blueprintId) {
    try {
      const { getBlueprint, resolveBlueprint } = await import('../../blueprints/index.js');
      const bp = getBlueprint(options.blueprintId);
      if (bp) {
        const resolved = resolveBlueprint(bp, options.blueprintAnswers ?? {});
        blueprintOption = { blueprint: bp, resolved };
        console.error(chalk.dim(`  Blueprint: ${bp.name} (${resolved.length} concerns)`));
      } else {
        warnings.push(`Blueprint "${options.blueprintId}" not found, skipping`);
      }
    } catch (err) {
      warnings.push(`Failed to load blueprint: ${(err as Error).message}`);
    }
  }

  // --- Step 4: Phase 2 — Task Generation ---
  console.error(chalk.dim('  Phase 2: Task generation...'));
  const phase2Messages = buildTaskGenerationPrompt(analysis, documentContent, {
    style: options.style,
    numTasks: options.numTasks,
    blueprint: blueprintOption,
  });
  const phase2Response = await callAI(phase2Messages, options.model, options.provider, 'parser-taskgen');
  const phase2Content = phase2Response.choices?.[0]?.message?.content;

  if (!phase2Content) {
    throw new Error('Phase 2 AI returned empty response');
  }

  let aiTasks: AITaskWithTags[];
  try {
    aiTasks = parsePhase2Response(phase2Content);
  } catch (err) {
    throw new Error(`Phase 2 response failed validation: ${(err as Error).message}`);
  }

  if (aiTasks.length === 0) {
    throw new Error('Phase 2 returned no tasks');
  }

  // --- Step 5: Hydrate TaskNodes ---
  const style = PROJECT_STYLES[options.style];
  const validTypes = style ? style.hierarchy : ['task'];

  const tasks = aiTasks.map((aiTask, i) =>
    aiTaskToNode(aiTask, '', i + 1, options.defaultStatus, validTypes),
  );

  // Resolve title-based dependencies
  const titleMap = buildTitleMap(tasks);
  resolveDependencies(tasks, aiTasks, titleMap);

  // Infer interface-based dependencies
  inferInterfaceDependencies(tasks, analysis);

  console.error(
    chalk.dim(`  Generated ${tasks.length} top-level task(s)`),
  );

  return { analysis, tasks, warnings, componentIndex, symbolIndex };
}
