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

// Mock auth modules (wizard calls resolveActiveAuth and getProvider)
vi.mock('../../../src/auth/call-ai.js', () => ({
  resolveActiveAuth: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/auth/provider-registry.js', () => ({
  getProvider: vi.fn().mockReturnValue({
    listModels: vi.fn().mockResolvedValue(null),
  }),
}));

// Mock projects listing (wizard calls listAllProjects in Step 0)
vi.mock('../../../src/utils/projects.js', () => ({
  listAllProjects: vi.fn().mockResolvedValue({ active: null, activeLocation: null, projects: [] }),
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
      provider: 'copilot',
      model: 'gpt-4.1',
      thresholds: { expand: 5, flag: 8 },
      location: 'home',
      gitignore: false,
    };

    const result = await runInitWizard(opts);

    expect(result).toEqual(opts);
    expect(mockInput).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockCheckbox).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockNumber).not.toHaveBeenCalled();
  });

  it('prompts for all fields when no opts provided (no git context)', async () => {
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
    // Step 6: provider
    mockSelect.mockResolvedValueOnce('copilot');
    // Step 7: model (fallback list since no auth)
    mockSelect.mockResolvedValueOnce('gpt-4.1');
    // Step 8: expand threshold
    mockNumber.mockResolvedValueOnce(5);
    // Step 8b: flag threshold
    mockNumber.mockResolvedValueOnce(8);

    const result = await runInitWizard(undefined, { gitRoot: null });

    expect(result).toEqual({
      name: 'my-project',
      description: 'A test project',
      style: 'task-only',
      statePreset: 'standard',
      skills: ['backend'],
      provider: 'copilot',
      model: 'gpt-4.1',
      thresholds: { expand: 5, flag: 8 },
      location: 'home',
      gitignore: false,
    });
  });

  it('prompts for storage location when git root is present', async () => {
    // Step 1: name
    mockInput.mockResolvedValueOnce('my-project');
    // Step 1b: storage location (git root present)
    mockSelect.mockResolvedValueOnce('repo');
    // Step 1c: gitignore (repo selected)
    mockSelect.mockResolvedValueOnce('yes');
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
    // Step 6: provider
    mockSelect.mockResolvedValueOnce('copilot');
    // Step 7: model
    mockSelect.mockResolvedValueOnce('gpt-4.1');
    // Step 8: thresholds
    mockNumber.mockResolvedValueOnce(5);
    mockNumber.mockResolvedValueOnce(8);

    const result = await runInitWizard(undefined, { gitRoot: '/tmp/my-repo' });

    expect(result.location).toBe('repo');
    expect(result.gitignore).toBe(true);
  });

  it('uses opt values for provided fields only', async () => {
    // Provide name and style, prompt for the rest
    mockInput.mockResolvedValueOnce('Some description');
    mockSelect.mockResolvedValueOnce('kanban');
    mockCheckbox.mockResolvedValueOnce(['frontend', 'database']);
    mockConfirm.mockResolvedValueOnce(false);
    // provider
    mockSelect.mockResolvedValueOnce('anthropic');
    // model (fallback list)
    mockSelect.mockResolvedValueOnce('gpt-4o');
    mockNumber.mockResolvedValueOnce(4);
    mockNumber.mockResolvedValueOnce(9);

    const result = await runInitWizard({
      name: 'preset-project',
      style: 'agile-full',
      location: 'home',
      gitignore: false,
    });

    expect(result.name).toBe('preset-project');
    expect(result.style).toBe('agile-full');
    expect(result.location).toBe('home');
    expect(result.gitignore).toBe(false);
    // These were prompted for:
    expect(result.description).toBe('Some description');
    expect(result.statePreset).toBe('kanban');
    expect(result.skills).toEqual(['frontend', 'database']);
    expect(result.provider).toBe('anthropic');
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
    // provider
    mockSelect.mockResolvedValueOnce('copilot');
    // model
    mockSelect.mockResolvedValueOnce('gpt-4.1');
    mockNumber.mockResolvedValueOnce(5);
    mockNumber.mockResolvedValueOnce(8);

    const result = await runInitWizard(
      { location: 'home', gitignore: false },
      { gitRoot: null },
    );

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
    // provider
    mockSelect.mockResolvedValueOnce('copilot');
    // model
    mockSelect.mockResolvedValueOnce('gpt-4.1');
    mockNumber.mockResolvedValueOnce(5);
    mockNumber.mockResolvedValueOnce(8);

    const result = await runInitWizard(
      { location: 'home', gitignore: false },
      { gitRoot: null },
    );

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
      provider: 'copilot',
      model: 'gpt-4.1',
      thresholds: { expand: 5, flag: 8 },
      location: 'home',
      gitignore: false,
    });

    expect(result.name).toBe('my-project');
    expect(result.description).toBe('some desc');
  });

  it('returns switchTo result when existing project is selected', async () => {
    // Mock listAllProjects to return existing projects
    const { listAllProjects } = await import('../../../src/utils/projects.js');
    vi.mocked(listAllProjects).mockResolvedValueOnce({
      active: 'existing-project',
      activeLocation: 'home',
      projects: [
        { name: 'existing-project', location: 'home', created: '2026-01-01', description: 'Existing' },
      ],
    });

    // User selects the existing project
    mockSelect.mockResolvedValueOnce('home:existing-project');

    const result = await runInitWizard(undefined, { gitRoot: null });

    expect(result.switchTo).toBe('existing-project');
    expect(result.switchToLocation).toBe('home');
  });

  it('handles switchTo from opts', async () => {
    const result = await runInitWizard({
      switchTo: 'some-project',
      switchToLocation: 'repo',
    });

    expect(result.switchTo).toBe('some-project');
    expect(result.switchToLocation).toBe('repo');
    expect(result.location).toBe('repo');
  });
});
