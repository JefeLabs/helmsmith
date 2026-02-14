import type { TaskNode } from '../config/schema.js';
import type { ProjectConfig } from '../config/schema.js';
import type { ChatCompletionMessage } from '../auth/types.js';
import { callCopilot } from '../auth/token-manager.js';
import { resolveGitHubToken } from '../auth/token-manager.js';
import { BUILT_IN_SKILLS, type SkillInferenceResult } from './types.js';

// --- Keyword-to-skill mapping ---

const SKILL_KEYWORDS: Record<string, readonly string[]> = {
  backend: ['api', 'endpoint', 'server', 'route', 'middleware', 'controller', 'service', 'handler', 'microservice'],
  frontend: ['ui', 'component', 'page', 'form', 'modal', 'css', 'responsive', 'layout', 'view', 'react', 'vue', 'angular'],
  database: ['database', 'schema', 'migration', 'query', 'sql', 'orm', 'table', 'index', 'storage', 'postgres', 'mysql', 'mongodb'],
  devops: ['deploy', 'ci/cd', 'docker', 'kubernetes', 'pipeline', 'monitoring', 'hosting', 'nginx', 'helm'],
  testing: ['test', 'coverage', 'e2e', 'integration', 'unit', 'mock', 'fixture', 'vitest', 'jest', 'playwright'],
  auth: ['auth', 'oauth', 'token', 'permission', 'encryption', 'rbac', 'cors', 'credential', 'jwt', 'session'],
  'api-design': ['rest', 'graphql', 'openapi', 'swagger', 'endpoint design', 'api contract', 'grpc', 'websocket'],
  'ui-ux': ['design', 'wireframe', 'prototype', 'accessibility', 'a11y', 'usability', 'figma', 'sketch'],
  infrastructure: ['scaling', 'load balancer', 'cdn', 'cloud', 'aws', 'gcp', 'azure', 'terraform', 'serverless'],
  documentation: ['docs', 'readme', 'guide', 'tutorial', 'changelog', 'jsdoc', 'typedoc', 'man page'],
} as const;

// --- Helpers ---

/**
 * Word-boundary keyword match. Multi-word keywords use includes(),
 * single words use \b regex to avoid partial matches.
 */
function keywordMatch(text: string, keyword: string): boolean {
  if (keyword.includes(' ') || keyword.includes('/')) {
    return text.includes(keyword);
  }
  const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return pattern.test(text);
}

/**
 * Merge built-in skills with user-defined vocabulary from config.
 * Returns a deduplicated, sorted array.
 */
export function getEffectiveVocabulary(configVocabulary: string[]): string[] {
  return [...new Set([...BUILT_IN_SKILLS, ...configVocabulary])].sort();
}

// --- Keyword-based inference ---

/**
 * Infer skills by scanning task title + description for keyword matches.
 * Returns only skills present in the effective vocabulary.
 */
export function inferSkillsByKeyword(task: TaskNode, vocabulary: string[]): string[] {
  const text = `${task.title} ${task.description}`.toLowerCase();
  const matched = new Set<string>();

  for (const [skill, keywords] of Object.entries(SKILL_KEYWORDS)) {
    if (!vocabulary.includes(skill)) continue;
    for (const kw of keywords) {
      if (keywordMatch(text, kw.toLowerCase())) {
        matched.add(skill);
        break;
      }
    }
  }

  return [...matched].sort();
}

// --- AI-based inference ---

/**
 * Build the prompt messages for AI skill inference via Copilot.
 */
export function buildSkillInferencePrompt(
  task: TaskNode,
  vocabulary: string[],
): ChatCompletionMessage[] {
  return [
    {
      role: 'system',
      content:
        'You are a skill classifier for software development tasks. ' +
        'Given a task and a vocabulary of skills, return ONLY a JSON object ' +
        'with no additional text, markdown, or explanation. ' +
        'Format: {"skills": ["skill1", "skill2"]}. ' +
        'Only use skills from the provided vocabulary. ' +
        'Assign 1-3 skills that best match the task.',
    },
    {
      role: 'user',
      content: [
        `Task title: ${task.title}`,
        `Task description: ${task.description || 'No description provided'}`,
        `Vocabulary: ${JSON.stringify(vocabulary)}`,
      ].join('\n'),
    },
  ];
}

interface AISkillResponse {
  skills: string[];
}

/**
 * Parse the AI response JSON. Returns the skills array or null on failure.
 * Strips markdown code fences if present. Filters to vocabulary only.
 */
export function parseSkillInferenceResponse(
  content: string,
  vocabulary: string[],
): string[] | null {
  try {
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned) as AISkillResponse;

    if (!Array.isArray(parsed.skills)) {
      return null;
    }

    // Filter to only skills in the vocabulary
    const valid = parsed.skills.filter(
      (s) => typeof s === 'string' && vocabulary.includes(s),
    );

    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

/**
 * Infer skills for a single task. Tries AI first, falls back to keyword-based.
 * When AI inference fails, logs the reason and returns keyword-based results
 * with a `fallbackReason` so callers can surface the warning.
 */
export async function inferSkillsForTask(
  task: TaskNode,
  vocabulary: string[],
  model: string,
  aiAvailable: boolean,
): Promise<SkillInferenceResult> {
  let fallbackReason: string | undefined;

  // Try AI inference first
  if (aiAvailable) {
    try {
      const messages = buildSkillInferencePrompt(task, vocabulary);
      const response = await callCopilot(messages, model);
      const content = response.choices?.[0]?.message?.content;

      if (content) {
        const skills = parseSkillInferenceResponse(content, vocabulary);
        if (skills) {
          return { taskId: task.id, skills, method: 'ai' };
        }
        fallbackReason = `AI returned unparseable response for task ${task.id}`;
      } else {
        fallbackReason = `AI returned empty response for task ${task.id}`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fallbackReason = `Copilot API error for task ${task.id}: ${message}`;
    }
  }

  // Keyword-based fallback
  const skills = inferSkillsByKeyword(task, vocabulary);
  return { taskId: task.id, skills, method: 'keyword', fallbackReason };
}

/**
 * Infer skills for an array of tasks. Mutates requiredSkills in place.
 * Checks config.skills.auto_infer -- returns early if false.
 * Called by the parse command after parsePlan().
 */
export async function inferSkills(
  tasks: TaskNode[],
  config: ProjectConfig,
): Promise<SkillInferenceResult[]> {
  if (!config.skills.auto_infer) {
    return [];
  }

  const vocabulary = getEffectiveVocabulary(config.skills.vocabulary);
  const model = config.ai.model;

  // Check AI availability
  const tokenSource = await resolveGitHubToken();
  const aiAvailable = tokenSource !== null;

  const results: SkillInferenceResult[] = [];

  for (const task of tasks) {
    const result = await inferSkillsForTask(task, vocabulary, model, aiAvailable);
    task.requiredSkills = result.skills;
    task.metadata.skillsInferred = true;
    results.push(result);
  }

  return results;
}

/**
 * Inherit skills from a parent task onto subtasks (additive-only).
 * Each subtask gets all parent skills. If AI is available and auto_infer is true,
 * AI may add additional skills per subtask but never removes inherited ones.
 * Called by the decomposer (T-7) after generating subtasks.
 */
export async function inheritSkills(
  parent: TaskNode,
  subtasks: TaskNode[],
  config: ProjectConfig,
): Promise<TaskNode[]> {
  const vocabulary = getEffectiveVocabulary(config.skills.vocabulary);
  const model = config.ai.model;
  const parentSkills = parent.requiredSkills;

  // Check AI availability
  let aiAvailable = false;
  if (config.skills.auto_infer) {
    const tokenSource = await resolveGitHubToken();
    aiAvailable = tokenSource !== null;
  }

  for (const subtask of subtasks) {
    // Start with parent skills
    const inherited = new Set(parentSkills);

    // AI refinement: may add more skills but never remove inherited ones
    if (aiAvailable) {
      try {
        const result = await inferSkillsForTask(subtask, vocabulary, model, true);
        for (const skill of result.skills) {
          inherited.add(skill);
        }
      } catch {
        // Keep inherited skills only on AI failure
      }
    }

    subtask.requiredSkills = [...inherited].sort();
    subtask.metadata.skillsInferred = true;
  }

  return subtasks;
}
