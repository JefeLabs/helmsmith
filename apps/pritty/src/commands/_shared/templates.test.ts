import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_BY_PROVIDER } from '../../config.js';
import { PRITTY_SKILL } from './templates.js';

describe('PRITTY_SKILL config example', () => {
  it('shows the default model of the starter provider and no retired model name', () => {
    expect(PRITTY_SKILL).toContain(`"model": "${DEFAULT_MODEL_BY_PROVIDER.claude}"`);
    expect(PRITTY_SKILL).not.toContain('gpt-4o');
  });

  it('shows claude as the provider', () => {
    expect(PRITTY_SKILL).toMatch(/"provider": "claude",/);
  });
});

describe('PRITTY_SKILL config location', () => {
  it('names .helmsmith/pritty.json as a place pritty reads its config from', () => {
    expect(PRITTY_SKILL).toContain('.helmsmith/pritty.json');
  });
});

describe('slash command frontmatter', () => {
  it('parses as YAML for every command, so a quote inside argument-hint cannot break it', async () => {
    const { load } = await import('js-yaml');
    const { CLAUDE_COMMANDS } = await import('./templates.js');
    for (const [name, text] of Object.entries(CLAUDE_COMMANDS)) {
      const front = text.split('---')[1] ?? '';
      expect(() => load(front), name).not.toThrow();
      expect(load(front), name).toHaveProperty('description');
    }
  });
});

describe('commit flags in the skill and the /commit command', () => {
  it('lists --scope, --type and --trailer', async () => {
    const { CLAUDE_COMMANDS } = await import('./templates.js');
    for (const text of [PRITTY_SKILL, CLAUDE_COMMANDS.commit!]) {
      for (const flag of ['--scope', '--type', '--trailer']) expect(text).toContain(flag);
    }
  });
});

describe('PRITTY_SKILL pre-conditions', () => {
  it('checks for the claude binary, which `pritty auth status` does not list', () => {
    expect(PRITTY_SKILL).toContain('which claude');
  });
});

describe('agent commit inputs in the skill and the /commit command', () => {
  it('names --label, --message, --input=json and --output=json', async () => {
    const { CLAUDE_COMMANDS } = await import('./templates.js');
    for (const text of [PRITTY_SKILL, CLAUDE_COMMANDS.commit!]) {
      for (const token of ['--label', '--message', '--input=json', '--output=json']) {
        expect(text).toContain(token);
      }
    }
  });

  it('no longer tells an agent to hand-write commits with git commit -m', () => {
    expect(PRITTY_SKILL).not.toContain("That's bypassing the");
  });

  it('names --breaking and the optional label and breaking fields', async () => {
    const { CLAUDE_COMMANDS } = await import('./templates.js');
    for (const text of [PRITTY_SKILL, CLAUDE_COMMANDS.commit!]) {
      for (const token of ['--breaking', 'label?', 'breaking?']) expect(text).toContain(token);
    }
  });

  it('describes /commit per change, not only per category', async () => {
    const { CLAUDE_COMMANDS, COPILOT_PROMPTS } = await import('./templates.js');
    for (const text of [CLAUDE_COMMANDS.commit!, COPILOT_PROMPTS.commit!]) {
      expect(text).not.toMatch(/messages per category/);
      expect(text).toMatch(/per change/);
    }
  });

  it('says JSON runs are unattended where it warns against skipping confirmation', () => {
    expect(PRITTY_SKILL).toMatch(/Skip the confirmation flow[\s\S]*unattended by design/);
  });
});
