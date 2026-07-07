import type { InitOptions } from '../../init/init.js';
import { closePrompts, prompt, promptHidden } from '../../init/prompt.js';

/**
 * Fill in any init fields the user didn't pass via CLI args by
 * prompting interactively. Designed so passing every flag results in
 * zero prompts (good for scripts, CI), while passing nothing walks
 * the user through every required field.
 *
 * Mode is asked first because it gates which subsequent fields are
 * required — team mode needs apiUrl/apiKey/pin; standalone doesn't.
 *
 * Used by:
 *   - `skillzkit init` (commands/init.ts)
 *   - `skillzkit ui` first-run flow (commands/ui.ts), when no config
 *     exists yet
 */
export async function gatherInitOptions(
  cli: Partial<InitOptions> & { force?: boolean },
): Promise<InitOptions> {
  console.log('');
  console.log('skillzkit setup');
  console.log('');

  let mode: 'standalone' | 'team';
  if (cli.mode === 'standalone' || cli.mode === 'team') {
    mode = cli.mode;
  } else {
    const answer = (
      await prompt(
        'Mode? (1) standalone — use bundled skills  (2) team — connect to a shared API: ',
      )
    ).trim();
    if (answer === '1' || answer.toLowerCase().startsWith('s')) {
      mode = 'standalone';
    } else if (answer === '2' || answer.toLowerCase().startsWith('t')) {
      mode = 'team';
    } else {
      throw new Error(`Mode must be "standalone" or "team"`);
    }
  }

  const email = cli.email ?? (await prompt('Email: ')).trim();

  if (mode === 'standalone') {
    closePrompts();
    return { mode, email };
  }

  const apiUrl = cli.apiUrl ?? (await prompt('API URL (e.g. https://skillz.example.com): ')).trim();
  const apiKey = cli.apiKey ?? (await promptHidden('API key (from agentx-controlplane): ')).trim();
  const pin = cli.pin ?? (await promptHidden('PIN (min 6 chars, used to encrypt key at rest): '));

  return { mode, email, apiUrl, apiKey, pin };
}
