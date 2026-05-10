import { checkbox, confirm, select } from '@inquirer/prompts';
import type { ContextQuestion } from '../blueprints/types.js';

/**
 * Run interactive context questions for a blueprint.
 * Maps question types to Inquirer.js primitives:
 *   boolean     → confirm
 *   single-select → select
 *   multi-select  → checkbox
 */
export async function runBlueprintQuestions(
  questions: ContextQuestion[],
): Promise<Record<string, string | boolean | string[]>> {
  const answers: Record<string, string | boolean | string[]> = {};

  for (const q of questions) {
    switch (q.type) {
      case 'boolean': {
        const defaultVal = typeof q.default === 'boolean' ? q.default : true;
        answers[q.id] = await confirm({
          message: q.question,
          default: defaultVal,
        });
        break;
      }

      case 'single-select': {
        if (!q.options || q.options.length === 0) {
          throw new Error(`Context question "${q.id}" is single-select but has no options.`);
        }
        const choices = q.options.map((opt) => ({ name: opt, value: opt }));
        const defaultVal = typeof q.default === 'string' ? q.default : undefined;
        answers[q.id] = await select({
          message: q.question,
          choices,
          default: defaultVal,
        });
        break;
      }

      case 'multi-select': {
        if (!q.options || q.options.length === 0) {
          throw new Error(`Context question "${q.id}" is multi-select but has no options.`);
        }
        const choices = q.options.map((opt) => ({ name: opt, value: opt }));
        answers[q.id] = await checkbox({
          message: q.question,
          choices,
        });
        break;
      }
    }
  }

  return answers;
}
