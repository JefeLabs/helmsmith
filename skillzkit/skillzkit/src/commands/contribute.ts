import { SkillzkitApiError } from '../api/client.js';
import type { ContributionKind } from '../api/contracts.js';
import { configExists } from '../init/config.js';
import { type ContributeRunArgs, runContribute } from '../init/contribute-flow.js';
import { promptHidden } from '../init/prompt.js';
import { renderApiError } from './_shared/render-api-error.js';

export interface ContributeCliOptions {
  kind?: string;
  slug?: string;
  bump?: string;
  changelog?: string;
}

/**
 * Submit a new contribution. <path> is a .md file
 * (command/workflow) or a directory containing SKILL.md (skill
 * bundle). Requires team mode + a valid PIN.
 */
export async function runContributeCommand(
  path: string,
  options: ContributeCliOptions = {},
): Promise<void> {
  try {
    if (!configExists()) {
      console.error(`No skillzkit config found. Run \`skillzkit init --mode team\` first.`);
      process.exit(1);
    }
    const kind = options.kind as ContributionKind | undefined;
    if (kind && kind !== 'command' && kind !== 'workflow' && kind !== 'skill') {
      console.error(`Invalid --kind: ${options.kind}. Must be command, workflow, or skill.`);
      process.exit(1);
    }
    const bump = options.bump as ContributeRunArgs['versionBump'];
    if (bump !== undefined && bump !== 'major' && bump !== 'minor' && bump !== 'patch') {
      console.error(`Invalid --bump: ${options.bump}. Must be major, minor, or patch.`);
      process.exit(1);
    }

    const result = await runContribute({
      inputPath: path,
      kindOverride: kind,
      slugOverride: options.slug,
      versionBump: bump,
      changelog: options.changelog,
      pinProvider: () => promptHidden('PIN to decrypt API key (set during `skillzkit init`): '),
    });

    console.log('');
    console.log(`✓ Accepted ${result.kind}:${result.slug}@${result.version}`);
    console.log(`  Contribution id: ${result.id}`);
    console.log('');
    console.log('This version is stored but NOT yet promoted to live.');
    console.log('A maintainer can promote via:');
    console.log(`  curl -X POST -H "Authorization: Bearer <admin-key>" \\`);
    console.log(`    <api-url>/api/v1/contributions/${encodeURIComponent(result.id)}/promote`);
  } catch (err) {
    if (err instanceof SkillzkitApiError) {
      renderApiError(err);
      process.exit(1);
    }
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}
