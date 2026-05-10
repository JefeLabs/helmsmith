/**
 * The built-in catalog of canonical tool names → manager-specific
 * package names. Lives in its own module so config/catalog.ts can
 * merge it with the user catalog without creating a circular import
 * with tool-resolver.ts.
 *
 * To add a tool: append an entry here. If the package name diverges
 * across managers (e.g. `fd` is `fd-find` on apt), spell each manager
 * out. Names that match across all managers (most tools) keep the
 * entry compact.
 */

import type { PackageManagerType } from '../platform/types.js';

export interface CatalogEntry {
  /** Human description shown in `toolz catalog` listings. */
  description: string;
  /** Map from package manager type → package name. */
  packages: Partial<Record<PackageManagerType, string>>;
}

export const BUILT_IN_CATALOG: Record<string, CatalogEntry> = {
  git: {
    description: 'Distributed version control system',
    packages: { brew: 'git', apt: 'git', winget: 'Git.Git' },
  },
  gh: {
    description: 'GitHub CLI',
    packages: { brew: 'gh', apt: 'gh', winget: 'GitHub.cli' },
  },
  jq: {
    description: 'JSON processor',
    packages: { brew: 'jq', apt: 'jq', winget: 'stedolan.jq' },
  },
  yq: {
    description: 'YAML processor',
    packages: { brew: 'yq', apt: 'yq', winget: 'MikeFarah.yq' },
  },
  ripgrep: {
    description: 'Fast text search (rg)',
    packages: {
      brew: 'ripgrep',
      apt: 'ripgrep',
      winget: 'BurntSushi.ripgrep.MSVC',
    },
  },
  fd: {
    description: 'Fast find alternative',
    packages: {
      brew: 'fd',
      apt: 'fd-find',
      winget: 'sharkdp.fd',
    },
  },
  pandoc: {
    description: 'Document converter',
    packages: { brew: 'pandoc', apt: 'pandoc', winget: 'JohnMacFarlane.Pandoc' },
  },
  ffmpeg: {
    description: 'Audio/video processing',
    packages: { brew: 'ffmpeg', apt: 'ffmpeg', winget: 'Gyan.FFmpeg' },
  },
  acli: {
    description:
      "Atlassian CLI — Jira / Confluence / Bitbucket Cloud (used by @ecruz165/pritty's jira-cli adapter)",
    packages: {
      // Atlassian distributes via their own brew tap; brew auto-taps
      // when given the full <tap>/<formula> identifier.
      brew: 'atlassian-labs/acli/acli',
      // apt + winget: Atlassian doesn't currently publish official
      // packages there. Users on those platforms install manually
      // from https://developer.atlassian.com/cloud/acli/.
    },
  },
  pritty: {
    description:
      'AI-powered commit & PR CLI — categorize staged files, generate conventional commits, open PRs, all with human-in-the-loop. Part of agentx-toolbox.',
    packages: {
      // Once @ecruz165/pritty is published to npm, all package
      // managers can install it via npm. Today this entry is a
      // forward-compatible declaration; before publish, users
      // workspace-link from agentx-toolbox.
      brew: '@ecruz165/pritty',
      apt: '@ecruz165/pritty',
      winget: '@ecruz165/pritty',
    },
  },
};
