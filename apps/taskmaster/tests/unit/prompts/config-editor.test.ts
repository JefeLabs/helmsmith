import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../../../src/config/schema.js';
import {
  applyConfigValue,
  CONFIG_KEYS,
  getConfigValue,
  validateConfigValue,
} from '../../../src/prompts/config-editor.js';

const sampleConfig: ProjectConfig = {
  style: 'task-only',
  states: {
    preset: 'standard',
    enforce_transitions: false,
  },
  skills: {
    vocabulary: ['backend', 'frontend'],
    auto_infer: true,
  },
  ai: {
    model: 'claude-sonnet-4-20250514',
  },
  thresholds: {
    expand: 5,
    flag: 8,
  },
};

describe('config-editor', () => {
  describe('CONFIG_KEYS', () => {
    it('includes all expected keys', () => {
      const keys = CONFIG_KEYS.map((k) => k.key);
      expect(keys).toContain('style');
      expect(keys).toContain('states.preset');
      expect(keys).toContain('states.enforce_transitions');
      expect(keys).toContain('ai.model');
      expect(keys).toContain('thresholds.expand');
      expect(keys).toContain('thresholds.flag');
      expect(keys).toContain('skills.auto_infer');
    });
  });

  describe('getConfigValue', () => {
    it('returns style value', () => {
      expect(getConfigValue(sampleConfig, 'style')).toBe('task-only');
    });

    it('returns states.preset value', () => {
      expect(getConfigValue(sampleConfig, 'states.preset')).toBe('standard');
    });

    it('returns states.enforce_transitions value', () => {
      expect(getConfigValue(sampleConfig, 'states.enforce_transitions')).toBe('false');
    });

    it('returns ai.model value', () => {
      expect(getConfigValue(sampleConfig, 'ai.model')).toBe('claude-sonnet-4-20250514');
    });

    it('returns thresholds.expand value', () => {
      expect(getConfigValue(sampleConfig, 'thresholds.expand')).toBe('5');
    });

    it('returns thresholds.flag value', () => {
      expect(getConfigValue(sampleConfig, 'thresholds.flag')).toBe('8');
    });

    it('returns skills.auto_infer value', () => {
      expect(getConfigValue(sampleConfig, 'skills.auto_infer')).toBe('true');
    });

    it('returns null for unknown keys', () => {
      expect(getConfigValue(sampleConfig, 'nonexistent')).toBeNull();
      expect(getConfigValue(sampleConfig, 'deeply.nested.key')).toBeNull();
    });
  });

  describe('validateConfigValue', () => {
    it('accepts valid style values', () => {
      expect(validateConfigValue('style', 'task-only')).toEqual({ valid: true });
      expect(validateConfigValue('style', 'agile-full')).toEqual({ valid: true });
      expect(validateConfigValue('style', 'story-driven')).toEqual({ valid: true });
      expect(validateConfigValue('style', 'flat')).toEqual({ valid: true });
    });

    it('rejects invalid style values', () => {
      const result = validateConfigValue('style', 'invalid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid style');
    });

    it('accepts valid preset values', () => {
      expect(validateConfigValue('states.preset', 'simple')).toEqual({ valid: true });
      expect(validateConfigValue('states.preset', 'standard')).toEqual({ valid: true });
      expect(validateConfigValue('states.preset', 'kanban')).toEqual({ valid: true });
      expect(validateConfigValue('states.preset', 'custom')).toEqual({ valid: true });
    });

    it('rejects invalid preset values', () => {
      const result = validateConfigValue('states.preset', 'nope');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid preset');
    });

    it('accepts valid boolean values for enforce_transitions', () => {
      expect(validateConfigValue('states.enforce_transitions', 'true')).toEqual({ valid: true });
      expect(validateConfigValue('states.enforce_transitions', 'false')).toEqual({ valid: true });
    });

    it('rejects invalid boolean values', () => {
      const result = validateConfigValue('states.enforce_transitions', 'yes');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('true');
    });

    it('accepts valid threshold values (integers 1-10)', () => {
      expect(validateConfigValue('thresholds.expand', '1')).toEqual({ valid: true });
      expect(validateConfigValue('thresholds.expand', '5')).toEqual({ valid: true });
      expect(validateConfigValue('thresholds.expand', '10')).toEqual({ valid: true });
    });

    it('rejects invalid threshold values', () => {
      expect(validateConfigValue('thresholds.expand', '0').valid).toBe(false);
      expect(validateConfigValue('thresholds.expand', '11').valid).toBe(false);
      expect(validateConfigValue('thresholds.expand', 'abc').valid).toBe(false);
      expect(validateConfigValue('thresholds.expand', '5.5').valid).toBe(false);
    });

    it('accepts non-empty model names', () => {
      expect(validateConfigValue('ai.model', 'gpt-4o')).toEqual({ valid: true });
    });

    it('rejects empty model names', () => {
      const result = validateConfigValue('ai.model', '');
      expect(result.valid).toBe(false);
    });

    it('rejects unknown keys', () => {
      const result = validateConfigValue('nonexistent', 'value');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown config key');
    });
  });

  describe('applyConfigValue', () => {
    it('produces flat patch for top-level keys', () => {
      expect(applyConfigValue('style', 'flat')).toEqual({ style: 'flat' });
    });

    it('produces nested patch for dot-notation keys', () => {
      expect(applyConfigValue('thresholds.expand', '7')).toEqual({
        thresholds: { expand: 7 },
      });
    });

    it('parses boolean strings', () => {
      expect(applyConfigValue('states.enforce_transitions', 'true')).toEqual({
        states: { enforce_transitions: true },
      });
      expect(applyConfigValue('states.enforce_transitions', 'false')).toEqual({
        states: { enforce_transitions: false },
      });
    });

    it('parses numeric strings', () => {
      expect(applyConfigValue('thresholds.flag', '8')).toEqual({
        thresholds: { flag: 8 },
      });
    });

    it('keeps non-numeric strings as strings', () => {
      expect(applyConfigValue('ai.model', 'gpt-4o')).toEqual({
        ai: { model: 'gpt-4o' },
      });
    });

    it('handles deeply nested keys', () => {
      expect(applyConfigValue('a.b.c', 'value')).toEqual({
        a: { b: { c: 'value' } },
      });
    });
  });
});
