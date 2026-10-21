import { confirm, editor, select } from '@inquirer/prompts';

/**
 * The three prompts the conflict resolver needs, behind an interface so
 * tests can script answers (see `src/test/scripted-prompts.ts`). The
 * default implementation is a thin adapter over @inquirer/prompts.
 */
export interface ResolverPrompts {
  select<T>(opts: { message: string; choices: Array<{ name: string; value: T }> }): Promise<T>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
  editor(opts: { message: string; default: string }): Promise<string>;
}

export const inquirerPrompts: ResolverPrompts = {
  select: (opts) => select(opts),
  confirm: (opts) => confirm(opts),
  editor: (opts) => editor(opts),
};
