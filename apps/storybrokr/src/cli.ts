import { createCli } from '@helmsmith/cli-kit';
import { VERSION } from './version.js';

const { program } = createCli({
  name: 'storybrokr',
  version: VERSION,
  description: 'Broker ephemeral single-component Storybook instances from an existing Storybook.',
});

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
