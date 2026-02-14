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

import {
  input,
  select,
  checkbox,
  confirm,
  number as numberPrompt,
} from '@inquirer/prompts';
import { runInitWizard, type InitWizardResult } from '../../../src/prompts/init-wizard.js';
import { resetDefaultsCache } from '../../../src/prompts/factory.js';

const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);
const mockCheckbox = vi.mocked(checkbox);
const mockConfirm = vi.mocked(confirm);
const mockNumber = vi.mocked(numberPrompt);

describe('init-wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDefaultsCache();
  });

  it('skips all prompts when all opts are provided', async () => {
    const opts: InitWizardResult = {
      name: 'my-project',
      description: 'A test project',
      style: 'task-only',
      statePreset: 'standard',
      skills: ['backend', 'frontend'],
      thresholds: { expand: 5, flag: 8 },
    };

    const result = await runInitWizard(opts);

    expect(result).toEqual(opts);
    expect(mockInput).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockCheckbox).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockNumber).not.toHaveBeenCalled();
  });

  it('prompts for all fields when no opts provided', async () => {
    // Step 1: name
    mockInput.mockResolvedValueOnce('my-project');
    // Step 2: description
    mockInput.mockResolvedValueOnce('A test project');
    // Step 3: style
    mockSelect.mockResolvedValueOnce('task-only');
    // Step 4: state preset
    mockSelect.mockResolvedValueOnce('standard');
    // Step 5: skills
    mockCheckbox.mockResolvedValueOnce(['backend']);
    // Step 5b: add custom skills?
    mockConfirm.mockResolvedValueOnce(false);
    // Step 6: expand threshold
    mockNumber.mockResolvedValueOnce(5);
    // Step 6b: flag threshold
    mockNumber.mockResolvedValueOnce(8);

    const result = await runInitWizard();

    expect(result).toEqual({
      name: 'my-project',
      description: 'A test project',
      style: 'task-only',
      statePreset: 'standard',
      skills: ['backend'],
      thresholds: { expand: 5, flag: 8 },
    });
  });

  it('uses opt values for provided fields only', async () => {
    // Provide name and style, prompt for the rest
    mockInput.mockResolvedValueOnce('Some description');
    mockSelect.mockResolvedValueOnce('kanban');
    mockCheckbox.mockResolvedValueOnce(['frontend', 'database']);
    mockConfirm.mockResolvedValueOnce(false);
    mockNumber.mockResolvedValueOnce(4);
    mockNumber.mockResolvedValueOnce(9);

    const result = await runInitWizard({
      name: 'preset-project',
      style: 'agile-full',
    });

    expect(result.name).toBe('preset-project');
    expect(result.style).toBe('agile-full');
    // These were prompted for:
    expect(result.description).toBe('Some description');
    expect(result.statePreset).toBe('kanban');
    expect(result.skills).toEqual(['frontend', 'database']);
    expect(result.thresholds).toEqual({ expand: 4, flag: 9 });
  });

  it('supports adding custom skills', async () => {
    mockInput.mockResolvedValueOnce('proj');
    mockInput.mockResolvedValueOnce('');
    mockSelect.mockResolvedValueOnce('flat');
    mockSelect.mockResolvedValueOnce('simple');
    mockCheckbox.mockResolvedValueOnce(['backend']);
    // Add custom skills? Yes
    mockConfirm.mockResolvedValueOnce(true);
    // Custom skills input
    mockInput.mockResolvedValueOnce('graphql, security');
    mockNumber.mockResolvedValueOnce(5);
    mockNumber.mockResolvedValueOnce(8);

    const result = await runInitWizard();

    expect(result.skills).toEqual(['backend', 'graphql', 'security']);
  });

  it('deduplicates custom skills with selected skills', async () => {
    mockInput.mockResolvedValueOnce('proj');
    mockInput.mockResolvedValueOnce('');
    mockSelect.mockResolvedValueOnce('flat');
    mockSelect.mockResolvedValueOnce('simple');
    mockCheckbox.mockResolvedValueOnce(['backend', 'frontend']);
    mockConfirm.mockResolvedValueOnce(true);
    // Custom includes "backend" which is already selected
    mockInput.mockResolvedValueOnce('backend, graphql');
    mockNumber.mockResolvedValueOnce(5);
    mockNumber.mockResolvedValueOnce(8);

    const result = await runInitWizard();

    // Should deduplicate
    expect(result.skills).toEqual(['backend', 'frontend', 'graphql']);
  });

  it('trims whitespace from name and description', async () => {
    const result = await runInitWizard({
      name: '  my-project  ',
      description: '  some desc  ',
      style: 'flat',
      statePreset: 'simple',
      skills: [],
      thresholds: { expand: 5, flag: 8 },
    });

    expect(result.name).toBe('my-project');
    expect(result.description).toBe('some desc');
  });
});
