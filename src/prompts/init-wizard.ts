import {
  inputWithDefault,
  listWithDefault,
  checkboxWithDefaults,
  numberWithDefault,
  confirmPrompt,
} from './factory.js';
import { STYLE_NAMES, PROJECT_STYLES } from '../config/styles.js';
import { PRESET_NAMES, STATE_PRESETS } from '../config/state-presets.js';
import { resolveActiveAuth } from '../auth/call-ai.js';
import { getProvider } from '../auth/provider-registry.js';
import { AI_PROVIDERS, type AIProviderName, type AIModelEntry } from '../auth/provider.js';
import type { ProjectLocation, ResolvedProject } from '../utils/location.js';
import type { TaggedProjectEntry } from '../utils/projects.js';
import { listAllProjects } from '../utils/projects.js';
import { formatProjectRef } from '../utils/location.js';
import { INSTRUCTION_FILES, AI_TOOLING_CHOICES, type AITooling } from '../context/index.js';

const DEFAULT_SKILLS = [
  'backend',
  'frontend',
  'database',
  'devops',
  'testing',
  'api-design',
  'ui-ux',
];

/**
 * Known model metadata: token limits we display in the wizard.
 * The API returns capability.limits but they can be missing or incomplete,
 * so we keep curated fallbacks for popular models.
 */
const KNOWN_MODEL_META: Record<string, { inputTokens: string; outputTokens: string }> = {
  'gpt-4.1':            { inputTokens: '1M',   outputTokens: '32K' },
  'gpt-4o':             { inputTokens: '128K',  outputTokens: '16K' },
  'gpt-4o-mini':        { inputTokens: '128K',  outputTokens: '16K' },
  'gpt-4':              { inputTokens: '8K',    outputTokens: '8K' },
  'gpt-3.5-turbo':      { inputTokens: '16K',   outputTokens: '4K' },
  'claude-sonnet-4.5':  { inputTokens: '200K',  outputTokens: '16K' },
  'claude-opus-4.5':    { inputTokens: '200K',  outputTokens: '32K' },
  'claude-haiku-4.5':   { inputTokens: '200K',  outputTokens: '8K' },
  'gpt-5.1-codex':      { inputTokens: '1M',    outputTokens: '32K' },
  'o3-mini':            { inputTokens: '200K',  outputTokens: '100K' },
  'o1':                 { inputTokens: '200K',  outputTokens: '100K' },
};

/** Format a token count for display (e.g. 1048576 → "1M", 32768 → "32K"). */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/**
 * Build a display description for a model using API data + known fallbacks.
 */
function describeModel(entry: AIModelEntry): string {
  const limits = entry.capabilities?.limits;
  const known = KNOWN_MODEL_META[entry.id];

  const input = limits?.max_prompt_tokens
    ? formatTokens(limits.max_prompt_tokens)
    : known?.inputTokens ?? '?';
  const output = limits?.max_output_tokens
    ? formatTokens(limits.max_output_tokens)
    : known?.outputTokens ?? '?';

  return `${input} in / ${output} out`;
}

interface ModelChoice {
  name: string;
  value: string;
  description: string;
}

/** Hardcoded fallback list when API is unavailable. */
const FALLBACK_MODELS: ModelChoice[] = [
  { name: 'gpt-4.1',  value: 'gpt-4.1',  description: '1M in / 32K out — best for large docs' },
  { name: 'gpt-4o',   value: 'gpt-4o',   description: '128K in / 16K out — fast, capable' },
  { name: 'gpt-4o-mini', value: 'gpt-4o-mini', description: '128K in / 16K out — low cost' },
];

export interface InitWizardResult {
  name: string;
  description: string;
  style: 'agile-full' | 'story-driven' | 'task-only' | 'flat';
  statePreset: 'simple' | 'standard' | 'kanban';
  skills: string[];
  provider: AIProviderName;
  model: string;
  thresholds: { expand: number; flag: number };
  location: ProjectLocation;
  gitignore: boolean;
  switchTo?: string;
  switchToLocation?: ProjectLocation;
  /** AI coding tool to install agent instructions for. */
  aiTooling?: AITooling;
  /** Which agent instruction roles to install (e.g., ['team-lead', 'developer']). */
  instructionIds?: string[];
}

export interface InitWizardContext {
  gitRoot: string | null;
}

/**
 * Multi-step init wizard for project setup.
 * Pass partial opts to skip corresponding prompts (for --no-interactive).
 * Returns a typed result object — caller handles side effects.
 */
export async function runInitWizard(
  opts?: Partial<InitWizardResult>,
  context?: InitWizardContext,
): Promise<InitWizardResult> {
  const gitRoot = context?.gitRoot ?? null;

  // Step 0: Show existing projects and offer switch
  if (!opts?.switchTo && !opts?.name) {
    const allProjects = await listAllProjects(gitRoot);
    if (allProjects.projects.length > 0) {
      const switchChoices: Array<{ name: string; value: string }> = [
        { name: 'Create a new project', value: '__new__' },
        ...allProjects.projects.map((p) => {
          const marker = p.name === allProjects.active && p.location === allProjects.activeLocation
            ? ' (active)'
            : '';
          return {
            name: `Switch to "${p.name}" [${p.location}]${marker}`,
            value: `${p.location}:${p.name}`,
          };
        }),
      ];

      const switchChoice = await listWithDefault(
        '__existingProjects',
        'Existing projects found. What would you like to do?',
        switchChoices,
      );

      if (switchChoice !== '__new__') {
        // Parse "location:name"
        const colonIndex = switchChoice.indexOf(':');
        const switchToLocation = switchChoice.substring(0, colonIndex) as ProjectLocation;
        const switchToName = switchChoice.substring(colonIndex + 1);
        return {
          name: '',
          description: '',
          style: 'task-only',
          statePreset: 'standard',
          skills: [],
          provider: 'copilot',
          model: 'gpt-4.1',
          thresholds: { expand: 5, flag: 8 },
          location: switchToLocation,
          gitignore: false,
          switchTo: switchToName,
          switchToLocation,
        };
      }
    }
  }

  // If switchTo was provided via opts, return early
  if (opts?.switchTo) {
    return {
      name: '',
      description: '',
      style: 'task-only',
      statePreset: 'standard',
      skills: [],
      provider: 'copilot',
      model: 'gpt-4.1',
      thresholds: { expand: 5, flag: 8 },
      location: opts.switchToLocation ?? 'home',
      gitignore: false,
      switchTo: opts.switchTo,
      switchToLocation: opts.switchToLocation,
    };
  }

  // Step 1: Project name
  const name =
    opts?.name ??
    (await inputWithDefault('projectName', 'Project name:', {
      validate: (v) => v.trim().length > 0 || 'Project name cannot be empty',
    }));

  // Step 1b: Storage location (only when in a git repo)
  let location: ProjectLocation;
  if (opts?.location) {
    location = opts.location;
  } else if (gitRoot) {
    const locationChoices = [
      { name: `In this repository (${gitRoot}/.agentx/taskmaster/)`, value: 'repo' as ProjectLocation },
      { name: 'In user home (~/.agentx/taskmaster/)', value: 'home' as ProjectLocation },
    ];
    location = await listWithDefault('__storageLocation', 'Where should project data be stored?', locationChoices);
  } else {
    location = 'home';
  }

  // Step 1c: Gitignore (only when repo-local)
  let gitignore: boolean;
  if (opts?.gitignore !== undefined) {
    gitignore = opts.gitignore;
  } else if (location === 'repo' && gitRoot) {
    const gitignoreChoices = [
      { name: 'No \u2014 add .agentx/ to .gitignore (private to you)', value: 'yes' },
      { name: 'Yes \u2014 track in git (shared with team)', value: 'no' },
    ];
    const choice = await listWithDefault('__gitignore', 'Include taskmaster data in source control?', gitignoreChoices);
    gitignore = choice === 'yes';
  } else {
    gitignore = false;
  }

  // Step 2: Description
  const description =
    opts?.description ??
    (await inputWithDefault('projectDescription', 'Project description (optional):'));

  // Step 3: Style selection
  const styleChoices = STYLE_NAMES.map((key) => ({
    name: `${PROJECT_STYLES[key].name} — ${PROJECT_STYLES[key].useCase}`,
    value: key as InitWizardResult['style'],
  }));
  const style = opts?.style ?? (await listWithDefault('style', 'Project style:', styleChoices));

  // Step 4: Status preset selection
  const presetChoices = PRESET_NAMES.map((key) => {
    const states = STATE_PRESETS[key];
    const stateNames = states.map((s) => s.name).join(' \u2192 ');
    return {
      name: `${key} (${stateNames})`,
      value: key as InitWizardResult['statePreset'],
    };
  });
  const statePreset =
    opts?.statePreset ??
    (await listWithDefault('statusPreset', 'Status preset:', presetChoices));

  // Step 5: Skill vocabulary (checkbox + optional custom entry)
  const skillChoices = DEFAULT_SKILLS.map((s) => ({ name: s, value: s }));
  let skills: string[];
  if (opts?.skills) {
    skills = opts.skills;
  } else {
    const selected = await checkboxWithDefaults(
      'skills',
      'Select skill vocabulary (space to toggle, enter to confirm):',
      skillChoices,
    );
    const addCustom = await confirmPrompt('Add custom skills?', false);
    if (addCustom) {
      const customInput = await inputWithDefault(
        'customSkills',
        'Enter custom skills (comma-separated):',
      );
      const customSkills = customInput
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      skills = [...new Set([...selected, ...customSkills])];
    } else {
      skills = selected;
    }
  }

  // Step 6: AI provider selection
  let provider: AIProviderName;
  if (opts?.provider) {
    provider = opts.provider;
  } else {
    const providerChoices = AI_PROVIDERS.map((p) => ({
      name: p === 'copilot' ? 'GitHub Copilot' : p === 'anthropic' ? 'Anthropic Claude' : 'OpenAI ChatGPT',
      value: p,
    }));
    provider = await listWithDefault('provider', 'AI provider:', providerChoices) as AIProviderName;
  }

  // Step 7: AI model selection (provider-aware, live from API when authenticated)
  let model: string;
  if (opts?.model) {
    model = opts.model;
  } else {
    const authResult = await resolveActiveAuth(provider);
    let modelChoices: Array<{ name: string; value: string }>;

    if (authResult) {
      // Fetch live models from the provider
      const providerInstance = getProvider(provider);
      const liveModels = await providerInstance.listModels();

      if (liveModels && liveModels.length > 0) {
        // Filter to chat-capable models and build choices with token metadata
        const chatModels = liveModels.filter(
          (m) => m.capabilities?.type === 'chat' || !m.capabilities?.type,
        );

        modelChoices = chatModels.map((entry) => ({
          name: `${entry.id} — ${describeModel(entry)}`,
          value: entry.id,
        }));
      } else {
        // API returned nothing — use fallback
        modelChoices = FALLBACK_MODELS.map((m) => ({
          name: `${m.name} — ${m.description}`,
          value: m.value,
        }));
      }
    } else {
      // Not authenticated — show fallback list
      modelChoices = FALLBACK_MODELS.map((m) => ({
        name: `${m.name} — ${m.description}`,
        value: m.value,
      }));
    }

    const authLabel = authResult
      ? `AI model (${modelChoices.length} available for your ${provider} subscription):`
      : `AI model (run "auth login --provider ${provider}" to see your available models):`;

    model = await listWithDefault('model', authLabel, modelChoices);
  }

  // Step 8: Thresholds
  const expandThreshold =
    opts?.thresholds?.expand ??
    (await numberWithDefault(
      'thresholds.expand',
      'Auto-expand threshold (tasks scoring above this are expanded):',
      { min: 1, max: 10, defaultValue: 5 },
    ));

  const flagThreshold =
    opts?.thresholds?.flag ??
    (await numberWithDefault(
      'thresholds.flag',
      'Flag-for-review threshold (tasks scoring above this are flagged):',
      { min: 1, max: 10, defaultValue: 8 },
    ));

  // Step 9: Agent instructions installation
  let aiTooling: AITooling | undefined;
  let instructionIds: string[] | undefined;

  if (opts?.aiTooling !== undefined) {
    aiTooling = opts.aiTooling;
    instructionIds = opts.instructionIds;
  } else {
    const installInstructions = await confirmPrompt(
      'Install agent instruction files for your AI coding tool?',
      true,
    );

    if (installInstructions) {
      const toolingChoices = AI_TOOLING_CHOICES.map((t) => ({
        name: `${t.label} — ${t.description}`,
        value: t.value,
      }));
      aiTooling = await listWithDefault('aiTooling', 'Which AI coding tool?', toolingChoices);

      const roleChoices = INSTRUCTION_FILES.map((f) => ({
        name: `${f.label} — ${f.description}`,
        value: f.id,
      }));
      instructionIds = await checkboxWithDefaults(
        'instructionIds',
        'Which agent roles to install?',
        roleChoices,
      );

      // If user deselected everything, skip installation
      if (instructionIds.length === 0) {
        aiTooling = undefined;
        instructionIds = undefined;
      }
    }
  }

  return {
    name: name.trim(),
    description: description.trim(),
    style,
    statePreset,
    skills,
    provider,
    model,
    thresholds: { expand: expandThreshold, flag: flagThreshold },
    location,
    gitignore,
    aiTooling,
    instructionIds,
  };
}
