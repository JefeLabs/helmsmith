import { confirm as inquirerConfirm, editor as inquirerEditor } from '@inquirer/prompts';

/**
 * Inquirer opens a prompt even when stdin is not a terminal, then dies with
 * "User force closed the prompt" and escape codes on stdout. Every prompt in
 * pritty goes through this guard instead, so an unattended run fails with
 * the flag that makes it unattended.
 */
export function guardPrompt<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  o: { isTTY: boolean } = { isTTY: Boolean(process.stdin.isTTY) },
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    if (!o.isTTY) {
      throw new Error(
        'This step needs a terminal to ask a question. Pass --auto-approve (or set autoApprove in .pritty.json) to run unattended.',
      );
    }
    return fn(...args);
  };
}

export const confirm = guardPrompt(
  (o: { message: string; default?: boolean }): Promise<boolean> => inquirerConfirm(o),
);
export const editor = guardPrompt(
  (o: { message: string; default?: string }): Promise<string> => inquirerEditor(o),
);
