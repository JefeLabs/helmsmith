import {
  inputWithDefault,
  listWithDefault,
  checkboxWithDefaults,
  numberWithDefault,
  confirmPrompt,
} from './factory.js';
import { STYLE_NAMES, PROJECT_STYLES } from '../config/styles.js';
import { PRESET_NAMES, STATE_PRESETS } from '../config/state-presets.js';
import { resolveGitHubToken, fetchCopilotModels } from '../auth/token-manager.js';
import type { CopilotModelEntry } from '../auth/types.js';

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
function describeModel(entry: CopilotModelEntry): string {
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
  model: string;
  thresholds: { expand: number; flag: number };
}

/**
 * Multi-step init wizard for project setup.
 * Pass partial opts to skip corresponding prompts (for --no-interactive).
 * Returns a typed result object — caller handles side effects.
 */
export async function runInitWizard(
  opts?: Partial<InitWizardResult>,
): Promise<InitWizardResult> {
  // Step 1: Project name
  const name =
    opts?.name ??
    (await inputWithDefault('projectName', 'Project name:', {
      validate: (v) => v.trim().length > 0 || 'Project name cannot be empty',
    }));

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
  // TODO: Add custom state wizard when needed
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

  // Step 6: AI model selection (live from Copilot API when authenticated)
  let model: string;
  if (opts?.model) {
    model = opts.model;
  } else {
    const tokenSource = await resolveGitHubToken();
    let modelChoices: Array<{ name: string; value: string }>;

    if (tokenSource) {
      // Fetch live models from the Copilot API
      const liveModels = await fetchCopilotModels();

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

    const authLabel = tokenSource
      ? `AI model (${modelChoices.length} available for your subscription):`
      : 'AI model (run "auth login" to see your available models):';

    model = await listWithDefault('model', authLabel, modelChoices);
  }

  // Step 7: Thresholds
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

  return {
    name: name.trim(),
    description: description.trim(),
    style,
    statePreset,
    skills,
    model,
    thresholds: { expand: expandThreshold, flag: flagThreshold },
  };
}
