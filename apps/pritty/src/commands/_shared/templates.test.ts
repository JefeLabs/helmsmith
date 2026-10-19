import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_BY_PROVIDER } from '../../config.js';
import { PRITTY_SKILL } from './templates.js';

describe('PRITTY_SKILL config example', () => {
  it('shows the default model of the starter provider and no retired model name', () => {
    expect(PRITTY_SKILL).toContain(`"model": "${DEFAULT_MODEL_BY_PROVIDER.copilot}"`);
    expect(PRITTY_SKILL).not.toContain('gpt-4o');
  });
});
