import type { AIProviderName } from '../auth/index.js';
import { type InitWizardResult, runInitWizard } from '../prompts/init-wizard.js';

export interface InitOpts {
  style?: string;
  name?: string;
  model?: string;
  repo?: boolean;
  interactive?: boolean;
}

export interface InitResult {
  /** Wizard result with all project settings. */
  wizardResult: InitWizardResult;
  /** Whether this is a switch-to-existing rather than a new project. */
  isSwitchTo: boolean;
}

/**
 * Build flag overrides from CLI options for non-interactive mode.
 */
function buildFlagOverrides(opts: InitOpts): Partial<InitWizardResult> {
  const overrides: Partial<InitWizardResult> = {};
  if (opts.name) overrides.name = opts.name;
  if (opts.style) overrides.style = opts.style as InitWizardResult['style'];
  if (opts.model) overrides.model = opts.model;
  if (opts.repo) overrides.location = 'repo';
  return overrides;
}

/**
 * Execute the init command: run the interactive wizard (or non-interactive
 * with flags) and return the configuration result.
 */
export async function executeInit(opts: InitOpts, gitRoot: string | null): Promise<InitResult> {
  const flagOverrides = buildFlagOverrides(opts);

  // --no-interactive: require at least --name, fill rest from defaults
  if (opts.interactive === false) {
    if (!flagOverrides.name) {
      throw new Error('--name is required when using --no-interactive.');
    }
    flagOverrides.description = flagOverrides.description ?? '';
    flagOverrides.style = flagOverrides.style ?? 'task-only';
    flagOverrides.statePreset = 'standard';
    flagOverrides.skills = ['backend', 'frontend', 'database', 'devops', 'testing'];
    flagOverrides.provider = flagOverrides.provider ?? ('copilot' as AIProviderName);
    flagOverrides.model = flagOverrides.model ?? 'gpt-4.1';
    flagOverrides.thresholds = { expand: 5, flag: 8 };
    flagOverrides.location = flagOverrides.location ?? 'home';
    flagOverrides.gitignore = flagOverrides.location === 'repo';
  }

  const wizardResult = await runInitWizard(
    opts.interactive === false
      ? flagOverrides
      : {
          name: flagOverrides.name,
          style: flagOverrides.style,
          model: flagOverrides.model,
          location: flagOverrides.location,
        },
    { gitRoot, interactive: opts.interactive !== false },
  );

  return {
    wizardResult,
    isSwitchTo: !!wizardResult.switchTo,
  };
}
