import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @inquirer/prompts before any imports
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  confirm: vi.fn(),
  search: vi.fn(),
  number: vi.fn(),
}));

// Mock defaults module
vi.mock('../../../src/utils/defaults.js', () => ({
  readDefaults: vi.fn(),
}));

import {
  checkbox,
  confirm,
  input,
  number as numberPrompt,
  search,
  select,
} from '@inquirer/prompts';
import {
  checkboxWithDefaults,
  confirmPrompt,
  inputWithDefault,
  listWithDefault,
  numberWithDefault,
  resetDefaultsCache,
  resolveDefault,
  searchPrompt,
} from '../../../src/prompts/factory.js';
import { readDefaults } from '../../../src/utils/defaults.js';

const mockReadDefaults = vi.mocked(readDefaults);
const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);
const mockCheckbox = vi.mocked(checkbox);
const mockConfirm = vi.mocked(confirm);
const mockSearch = vi.mocked(search);
const mockNumber = vi.mocked(numberPrompt);

describe('factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDefaultsCache();
  });

  describe('resolveDefault', () => {
    it('resolves top-level keys from defaults', async () => {
      mockReadDefaults.mockResolvedValue({
        style: 'task-only',
        model: 'gpt-4o',
        statusPreset: 'kanban',
        skills: ['backend', 'frontend'],
      });

      expect(await resolveDefault('style')).toBe('task-only');
      expect(await resolveDefault('model')).toBe('gpt-4o');
      expect(await resolveDefault('statusPreset')).toBe('kanban');
      expect(await resolveDefault('skills')).toEqual(['backend', 'frontend']);
    });

    it('resolves nested keys using dot notation', async () => {
      mockReadDefaults.mockResolvedValue({
        thresholds: { expand: 5, flag: 8 },
      });

      expect(await resolveDefault('thresholds.expand')).toBe(5);
      expect(await resolveDefault('thresholds.flag')).toBe(8);
    });

    it('returns undefined for missing keys', async () => {
      mockReadDefaults.mockResolvedValue({});

      expect(await resolveDefault('nonexistent')).toBeUndefined();
      expect(await resolveDefault('thresholds.expand')).toBeUndefined();
    });

    it('caches defaults after first read', async () => {
      mockReadDefaults.mockResolvedValue({ style: 'flat' });

      await resolveDefault('style');
      await resolveDefault('style');

      expect(mockReadDefaults).toHaveBeenCalledTimes(1);
    });

    it('resetDefaultsCache clears the cache', async () => {
      mockReadDefaults.mockResolvedValue({ style: 'flat' });

      await resolveDefault('style');
      resetDefaultsCache();
      await resolveDefault('style');

      expect(mockReadDefaults).toHaveBeenCalledTimes(2);
    });
  });

  describe('inputWithDefault', () => {
    it('passes saved default from defaults.yaml', async () => {
      mockReadDefaults.mockResolvedValue({ style: 'task-only' });
      mockInput.mockResolvedValue('my-project');

      const result = await inputWithDefault('style', 'Project style:');

      expect(result).toBe('my-project');
      expect(mockInput).toHaveBeenCalledWith({
        message: 'Project style:',
        default: 'task-only',
        validate: undefined,
      });
    });

    it('uses explicit defaultValue over saved default', async () => {
      mockReadDefaults.mockResolvedValue({ style: 'flat' });
      mockInput.mockResolvedValue('test');

      await inputWithDefault('style', 'Style:', { defaultValue: 'task-only' });

      expect(mockInput).toHaveBeenCalledWith({
        message: 'Style:',
        default: 'task-only',
        validate: undefined,
      });
    });

    it('passes validate function through', async () => {
      mockReadDefaults.mockResolvedValue({});
      mockInput.mockResolvedValue('valid');
      const validate = (v: string) => v.length > 0 || 'Required';

      await inputWithDefault('name', 'Name:', { validate });

      expect(mockInput).toHaveBeenCalledWith({
        message: 'Name:',
        default: undefined,
        validate,
      });
    });
  });

  describe('listWithDefault', () => {
    it('passes saved default to select', async () => {
      mockReadDefaults.mockResolvedValue({ style: 'flat' });
      mockSelect.mockResolvedValue('flat');

      const choices = [
        { name: 'Task Only', value: 'task-only' as const },
        { name: 'Flat', value: 'flat' as const },
      ];
      const result = await listWithDefault('style', 'Style:', choices);

      expect(result).toBe('flat');
      expect(mockSelect).toHaveBeenCalledWith({
        message: 'Style:',
        choices,
        default: 'flat',
      });
    });
  });

  describe('checkboxWithDefaults', () => {
    it('marks previously selected items as checked', async () => {
      mockReadDefaults.mockResolvedValue({ skills: ['backend', 'database'] });
      mockCheckbox.mockResolvedValue(['backend', 'database']);

      const choices = [
        { name: 'backend', value: 'backend' },
        { name: 'frontend', value: 'frontend' },
        { name: 'database', value: 'database' },
      ];

      await checkboxWithDefaults('skills', 'Skills:', choices);

      expect(mockCheckbox).toHaveBeenCalledWith({
        message: 'Skills:',
        choices: [
          { name: 'backend', value: 'backend', checked: true },
          { name: 'frontend', value: 'frontend', checked: false },
          { name: 'database', value: 'database', checked: true },
        ],
      });
    });
  });

  describe('confirmPrompt', () => {
    it('passes default value to confirm', async () => {
      mockConfirm.mockResolvedValue(true);

      const result = await confirmPrompt('Are you sure?', false);

      expect(result).toBe(true);
      expect(mockConfirm).toHaveBeenCalledWith({
        message: 'Are you sure?',
        default: false,
      });
    });

    it('defaults to true when no default specified', async () => {
      mockConfirm.mockResolvedValue(true);

      await confirmPrompt('Proceed?');

      expect(mockConfirm).toHaveBeenCalledWith({
        message: 'Proceed?',
        default: true,
      });
    });
  });

  describe('numberWithDefault', () => {
    it('passes saved default from defaults.yaml', async () => {
      mockReadDefaults.mockResolvedValue({ thresholds: { expand: 7 } });
      mockNumber.mockResolvedValue(7);

      const result = await numberWithDefault('thresholds.expand', 'Threshold:', {
        min: 1,
        max: 10,
      });

      expect(result).toBe(7);
      expect(mockNumber).toHaveBeenCalledWith({
        message: 'Threshold:',
        default: 7,
        min: 1,
        max: 10,
      });
    });

    it('uses explicit defaultValue over saved default', async () => {
      mockReadDefaults.mockResolvedValue({ thresholds: { expand: 3 } });
      mockNumber.mockResolvedValue(5);

      await numberWithDefault('thresholds.expand', 'Threshold:', { defaultValue: 5 });

      expect(mockNumber).toHaveBeenCalledWith({
        message: 'Threshold:',
        default: 5,
        min: undefined,
        max: undefined,
      });
    });

    it('returns defaultValue when prompt returns undefined', async () => {
      mockReadDefaults.mockResolvedValue({});
      mockNumber.mockResolvedValue(undefined as unknown as number);

      const result = await numberWithDefault('foo', 'Value:', { defaultValue: 42 });

      expect(result).toBe(42);
    });
  });

  describe('searchPrompt', () => {
    it('calls search with source function', async () => {
      mockSearch.mockResolvedValue('T-1');

      const choices = [
        { name: 'T-1: Scaffolding', value: 'T-1' },
        { name: 'T-2: Parser', value: 'T-2' },
      ];

      const result = await searchPrompt('Select task:', choices);

      expect(result).toBe('T-1');
      expect(mockSearch).toHaveBeenCalledWith({
        message: 'Select task:',
        source: expect.any(Function),
      });
    });

    it('source function filters by term', async () => {
      mockSearch.mockResolvedValue('T-2');

      const choices = [
        { name: 'T-1: Scaffolding', value: 'T-1' },
        { name: 'T-2: Parser', value: 'T-2' },
      ];

      await searchPrompt('Select:', choices);

      // Extract the source function and test it
      const searchCall = mockSearch.mock.calls[0][0];
      const source = searchCall.source as (term: string | undefined) => Promise<typeof choices>;

      const allResults = await source(undefined);
      expect(allResults).toEqual(choices);

      const filtered = await source('parser');
      expect(filtered).toEqual([{ name: 'T-2: Parser', value: 'T-2' }]);

      const byId = await source('T-1');
      expect(byId).toEqual([{ name: 'T-1: Scaffolding', value: 'T-1' }]);
    });
  });
});
