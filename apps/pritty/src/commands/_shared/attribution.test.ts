import { describe, expect, it } from 'vitest';
import { applyFooter, applyTrailers } from './attribution.js';

const TRAILER = 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>';
const FOOTER = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

describe('applyTrailers', () => {
  it('appends each trailer after a blank line, once', () => {
    expect(applyTrailers('feat: x', [TRAILER])).toBe(`feat: x\n\n${TRAILER}`);
    expect(applyTrailers(`feat: x\n\nbody\n\n${TRAILER}`, [TRAILER])).toBe(
      `feat: x\n\nbody\n\n${TRAILER}`,
    );
  });

  it('keeps an existing trailer block together', () => {
    expect(applyTrailers('feat: x\n\nSigned-off-by: a <a@x>', [TRAILER])).toBe(
      `feat: x\n\nSigned-off-by: a <a@x>\n${TRAILER}`,
    );
  });

  it('is the identity for no trailers', () => {
    expect(applyTrailers('feat: x\n\nbody', [])).toBe('feat: x\n\nbody');
  });
});

describe('applyFooter', () => {
  it('appends the footer after a blank line, once, and keeps it last on repeat', () => {
    expect(applyFooter('Body.', FOOTER)).toBe(`Body.\n\n${FOOTER}`);
    expect(applyFooter(`Body.\n\n${FOOTER}`, FOOTER)).toBe(`Body.\n\n${FOOTER}`);
    expect(applyFooter(`Body.\n\n${FOOTER}\n\nMore.`, FOOTER)).toBe(`Body.\n\nMore.\n\n${FOOTER}`);
  });

  it('is the identity for no footer', () => {
    expect(applyFooter('Body.', undefined)).toBe('Body.');
    expect(applyFooter('Body.', '')).toBe('Body.');
  });
});
