import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  staticDirs: ['../public'],
  // storybrokr spawns each instance with an ephemeral config dir under
  // node_modules/.cache/storybrokr/<id>/, which Storybook's Vite builder uses
  // as its config root — so vite.config.ts at the host root is never
  // auto-discovered there. Setting the alias here instead means it travels
  // with this config object (the ephemeral main.ts spreads `...host`), so it
  // reaches every instance regardless of where Vite looks for a config file.
  async viteFinal(viteConfig) {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      '@ui': fileURLToPath(new URL('../src/components', import.meta.url)),
    };
    return viteConfig;
  },
};
export default config;
