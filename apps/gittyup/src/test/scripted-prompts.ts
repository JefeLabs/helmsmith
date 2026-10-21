import type { ResolverPrompts } from '../core/resolver-prompts.js';

/** One recorded prompt invocation. */
export interface PromptCall {
  kind: 'select' | 'confirm' | 'editor';
  message: string;
  /** For `select`: the offered values, stringified, in order. */
  choices?: string[];
  /** For `editor`: the initial content handed to the editor. */
  default?: string;
}

/**
 * A `ResolverPrompts` that answers from a fixed list, in order, and records
 * every call. Throws when the script runs out so a test cannot silently
 * accept a prompt it did not expect.
 */
export function scriptedPrompts(answers: unknown[]): ResolverPrompts & { calls: PromptCall[] } {
  const queue = [...answers];
  const calls: PromptCall[] = [];
  const next = (kind: PromptCall['kind'], message: string): unknown => {
    if (queue.length === 0) throw new Error(`no scripted answer for ${kind}: ${message}`);
    return queue.shift();
  };
  return {
    calls,
    async select<T>(opts: { message: string; choices: Array<{ name: string; value: T }> }) {
      calls.push({
        kind: 'select',
        message: opts.message,
        choices: opts.choices.map((c) => String(c.value)),
      });
      return next('select', opts.message) as T;
    },
    async confirm(opts) {
      calls.push({ kind: 'confirm', message: opts.message });
      return next('confirm', opts.message) as boolean;
    },
    async editor(opts) {
      calls.push({ kind: 'editor', message: opts.message, default: opts.default });
      return next('editor', opts.message) as string;
    },
  };
}
