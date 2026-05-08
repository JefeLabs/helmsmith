import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  confirm: vi.fn(),
  search: vi.fn(),
  number: vi.fn(),
}));

// Mock defaults
vi.mock('../../../src/utils/defaults.js', () => ({
  readDefaults: vi.fn().mockResolvedValue({}),
}));

import { confirm, checkbox, number as numberPrompt } from '@inquirer/prompts';
import {
  confirmRemove,
  confirmExpand,
  confirmBulkOperation,
} from '../../../src/prompts/confirmations.js';
import { resetDefaultsCache } from '../../../src/prompts/factory.js';

const mockConfirm = vi.mocked(confirm);
const mockCheckbox = vi.mocked(checkbox);
const mockNumber = vi.mocked(numberPrompt);

describe('confirmations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDefaultsCache();
  });

  describe('confirmRemove', () => {
    it('returns confirmed: true when force is set', async () => {
      const result = await confirmRemove('T-1', 'Scaffolding', 3, { force: true });

      expect(result).toEqual({ confirmed: true });
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('prompts user without force flag', async () => {
      mockConfirm.mockResolvedValue(true);

      const result = await confirmRemove('T-1', 'Scaffolding', 3);

      expect(result).toEqual({ confirmed: true });
      expect(mockConfirm).toHaveBeenCalledWith({
        message: expect.stringContaining('T-1: Scaffolding'),
        default: false,
      });
    });

    it('includes child count in message', async () => {
      mockConfirm.mockResolvedValue(false);

      await confirmRemove('T-1', 'Scaffolding', 5);

      const call = mockConfirm.mock.calls[0][0];
      expect(call.message).toContain('5 child task(s)');
    });

    it('omits child count when zero', async () => {
      mockConfirm.mockResolvedValue(true);

      await confirmRemove('T-1', 'Scaffolding', 0);

      const call = mockConfirm.mock.calls[0][0];
      expect(call.message).not.toContain('child task');
    });

    it('returns confirmed: false when user declines', async () => {
      mockConfirm.mockResolvedValue(false);

      const result = await confirmRemove('T-1', 'Scaffolding', 0);

      expect(result).toEqual({ confirmed: false });
    });
  });

  describe('confirmExpand', () => {
    const tasks = [
      { id: 'T-1', title: 'Scaffolding', complexity: 5 },
      { id: 'T-2', title: 'Parser', complexity: 7 },
    ];

    it('returns immediately when confirmed opt is true', async () => {
      const result = await confirmExpand(tasks, {
        confirmed: true,
        taskIds: ['T-1'],
        maxSubtasks: 3,
      });

      expect(result).toEqual({
        taskIds: ['T-1'],
        maxSubtasks: 3,
        confirmed: true,
      });
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('defaults taskIds to all tasks when confirmed with no taskIds', async () => {
      const result = await confirmExpand(tasks, { confirmed: true });

      expect(result.taskIds).toEqual(['T-1', 'T-2']);
      expect(result.maxSubtasks).toBe(5);
    });

    it('prompts for single task expansion', async () => {
      mockNumber.mockResolvedValue(5);
      mockConfirm.mockResolvedValue(true);

      const result = await confirmExpand([tasks[0]]);

      expect(result).toEqual({
        taskIds: ['T-1'],
        maxSubtasks: 5,
        confirmed: true,
      });
    });

    it('prompts for task selection in bulk mode', async () => {
      mockCheckbox.mockResolvedValue(['T-1', 'T-2']);
      mockNumber.mockResolvedValue(5);
      mockConfirm.mockResolvedValue(true);

      const result = await confirmExpand(tasks);

      expect(result).toEqual({
        taskIds: ['T-1', 'T-2'],
        maxSubtasks: 5,
        confirmed: true,
      });
    });

    it('returns not confirmed when no tasks selected in bulk', async () => {
      mockCheckbox.mockResolvedValue([]);

      const result = await confirmExpand(tasks);

      expect(result).toEqual({
        taskIds: [],
        maxSubtasks: 5,
        confirmed: false,
      });
      expect(mockConfirm).not.toHaveBeenCalled();
    });
  });

  describe('confirmBulkOperation', () => {
    it('returns confirmed when force is set', async () => {
      const result = await confirmBulkOperation('Expand', 5, { force: true });

      expect(result).toEqual({ confirmed: true, dryRun: false });
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('preserves dryRun when force is set', async () => {
      const result = await confirmBulkOperation('Expand', 5, {
        force: true,
        dryRun: true,
      });

      expect(result).toEqual({ confirmed: true, dryRun: true });
    });

    it('returns confirmed with dryRun when user chooses dry-run', async () => {
      mockConfirm.mockResolvedValueOnce(true); // dry-run prompt

      const result = await confirmBulkOperation('Expand', 5);

      expect(result).toEqual({ confirmed: true, dryRun: true });
    });

    it('prompts for confirmation when dry-run declined', async () => {
      mockConfirm.mockResolvedValueOnce(false); // dry-run: no
      mockConfirm.mockResolvedValueOnce(true); // confirm: yes

      const result = await confirmBulkOperation('Expand', 5);

      expect(result).toEqual({ confirmed: true, dryRun: false });
      expect(mockConfirm).toHaveBeenCalledTimes(2);
    });
  });
});
