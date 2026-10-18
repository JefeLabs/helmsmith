import { describe, expect, it } from 'vitest';
import { renderRebaseTodo } from './format.js';

/**
 * git ignores any text after the hash on a todo line, so a planned message
 * has to be applied with an `exec git commit --amend` after the step (or
 * after the squash run it belongs to). Squash steps are rendered as fixup
 * because the message comes from the plan, not from an editor session.
 */
describe('renderRebaseTodo', () => {
  it('renders pick and drop verbatim', () => {
    expect(
      renderRebaseTodo([
        { hash: 'aaaa', action: 'pick' },
        { hash: 'bbbb', action: 'drop' },
      ]),
    ).toBe('pick aaaa\ndrop bbbb\n');
  });

  it('applies a reword message with an exec amend after the pick', () => {
    expect(renderRebaseTodo([{ hash: 'aaaa', action: 'reword', message: 'feat: clear' }])).toBe(
      "pick aaaa\nexec git commit --amend -m 'feat: clear'\n",
    );
  });

  it('turns a squash run into fixups followed by one amend with the planned message', () => {
    expect(
      renderRebaseTodo([
        { hash: 'aaaa', action: 'pick' },
        { hash: 'bbbb', action: 'squash', message: 'feat: combined' },
        { hash: 'cccc', action: 'squash' },
        { hash: 'dddd', action: 'pick' },
      ]),
    ).toBe(
      "pick aaaa\nfixup bbbb\nfixup cccc\nexec git commit --amend -m 'feat: combined'\npick dddd\n",
    );
  });

  it('takes the combined message from the pick that opens the run when the plan puts it there', () => {
    expect(
      renderRebaseTodo([
        { hash: 'aaaa', action: 'pick', message: 'feat: whole change' },
        { hash: 'bbbb', action: 'squash' },
      ]),
    ).toBe("pick aaaa\nfixup bbbb\nexec git commit --amend -m 'feat: whole change'\n");
  });

  it('emits no amend for a fixup run without a message', () => {
    expect(
      renderRebaseTodo([
        { hash: 'aaaa', action: 'pick' },
        { hash: 'bbbb', action: 'fixup' },
      ]),
    ).toBe('pick aaaa\nfixup bbbb\n');
  });

  it('shell-quotes messages with quotes and newlines', () => {
    expect(
      renderRebaseTodo([{ hash: 'aaaa', action: 'reword', message: "fix: don't\n\nbody $x" }]),
    ).toBe("pick aaaa\nexec git commit --amend -m 'fix: don'\\''t\n\nbody $x'\n");
  });
});
