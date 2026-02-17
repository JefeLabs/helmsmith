import type { TaskNode } from '../config/schema.js';
import type { ScoredResult, ScoringProvider } from './types.js';
import { HeuristicScorer } from './heuristic.js';
import { callAI } from '../auth/call-ai.js';
import type { AIProviderName } from '../auth/provider.js';
import type { ChatCompletionMessage } from '../auth/types.js';

/** Weight for AI score in the blended result. */
const AI_WEIGHT = 0.7;
/** Weight for heuristic score in the blended result. */
const HEURISTIC_WEIGHT = 0.3;

function getLabel(score: number): 'low' | 'medium' | 'high' {
  if (score <= 3) return 'low';
  if (score <= 6) return 'medium';
  return 'high';
}

/**
 * Build the prompt messages for AI complexity scoring.
 */
export function buildScoringPrompt(task: TaskNode): ChatCompletionMessage[] {
  const depCount = task.dependencies.length;
  const skills = task.requiredSkills.length > 0 ? task.requiredSkills.join(', ') : 'none specified';

  return [
    {
      role: 'system',
      content:
        'You are a software project complexity analyst. Analyze tasks and return ONLY a JSON object ' +
        'with no additional text, markdown, or explanation.',
    },
    {
      role: 'user',
      content: [
        'Analyze the following task and return ONLY a JSON object:',
        '',
        '{"score": <1-10>, "label": "<low|medium|high>", "reasoning": "<brief explanation>"}',
        '',
        'Score guidelines:',
        '- 1-3 (low): Simple, well-defined, single-concern tasks',
        '- 4-6 (medium): Moderate complexity, multiple concerns or integration points',
        '- 7-10 (high): Complex, cross-cutting, ambiguous, or architecturally significant',
        '',
        `Task title: ${task.title}`,
        `Task description: ${task.description || 'No description provided'}`,
        `Dependencies: ${depCount} task(s)`,
        `Required skills: ${skills}`,
      ].join('\n'),
    },
  ];
}

interface AIScoreResponse {
  score: number;
  label: string;
  reasoning: string;
}

/**
 * Parse the AI response JSON. Returns null if parsing fails.
 */
export function parseAIResponse(content: string): AIScoreResponse | null {
  try {
    // Strip markdown code fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.score !== 'number' ||
      parsed.score < 1 ||
      parsed.score > 10 ||
      typeof parsed.label !== 'string'
    ) {
      return null;
    }

    return {
      score: Math.round(parsed.score),
      label: parsed.label,
      reasoning: parsed.reasoning ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * AI-powered complexity scorer using GitHub Copilot.
 * Blends AI scores (70%) with heuristic scores (30%) for stability.
 * Falls back to heuristic-only on AI failure.
 */
export class AIScorer implements ScoringProvider {
  readonly name = 'ai';
  private model: string;
  private provider?: AIProviderName;
  private heuristic: HeuristicScorer;

  constructor(model: string, heuristic?: HeuristicScorer, provider?: AIProviderName) {
    this.model = model;
    this.provider = provider;
    this.heuristic = heuristic ?? new HeuristicScorer();
  }

  async scoreTask(task: TaskNode, allTasks: TaskNode[] = []): Promise<ScoredResult> {
    // Always run heuristic first — it provides the breakdown and fallback score
    const heuristicResult = await this.heuristic.scoreTask(task, allTasks);

    try {
      const messages = buildScoringPrompt(task);
      const response = await callAI(messages, this.model, this.provider);

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        return heuristicResult;
      }

      const aiResult = parseAIResponse(content);
      if (!aiResult) {
        return heuristicResult;
      }

      // Blend: 70% AI + 30% heuristic
      const blendedScore = Math.round(AI_WEIGHT * aiResult.score + HEURISTIC_WEIGHT * heuristicResult.score);
      const finalScore = Math.max(1, Math.min(10, blendedScore));

      return {
        taskId: task.id,
        score: finalScore,
        label: getLabel(finalScore),
        breakdown: heuristicResult.breakdown,
      };
    } catch {
      // Graceful fallback to heuristic on any AI error
      return heuristicResult;
    }
  }
}
