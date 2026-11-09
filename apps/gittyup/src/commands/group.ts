import chalk from 'chalk';
import type { Command } from 'commander';
import { ManifestManager } from '../config/manifest.js';
import type { GroupCreateDocument, GroupRemoveDocument } from '../output/contract.js';
import { emitJson } from '../output/json.js';

export function registerGroup(program: Command): void {
  const groupCmd = program.command('group').description('Manage groups');

  groupCmd
    .command('create <name>')
    .description('Create a new empty group')
    .option('-d, --desc <description>', 'Group description')
    .option('--json', 'Print { created: { group, description } } as one JSON line')
    .action(async (name: string, opts: { desc?: string; json?: boolean }) => {
      const manifest = new ManifestManager();
      manifest.createGroup(name, opts.desc);
      manifest.save();
      if (opts.json) {
        return emitJson({
          created: { group: name, description: opts.desc ?? null },
        } satisfies GroupCreateDocument);
      }
      console.log(chalk.green(`✓ Created group "${name}"`));
    });

  groupCmd
    .command('remove <name>')
    .description('Remove a group')
    .option('--json', 'Print { removed: { group } } as one JSON line')
    .action(async (name: string, opts: { json?: boolean }) => {
      const manifest = new ManifestManager();
      manifest.removeGroup(name);
      manifest.save();
      if (opts.json) return emitJson({ removed: { group: name } } satisfies GroupRemoveDocument);
      console.log(chalk.green(`✓ Removed group "${name}"`));
    });
}
