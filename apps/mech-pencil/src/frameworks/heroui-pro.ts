/**
 * HeroUI Pro adapter.
 *
 * HeroUI Pro is the same v3 design language plus production blocks &
 * templates — not a different primitive set. So it reuses HeroUI v3's
 * tokens, component catalog, and mockups verbatim. (Pro-specific
 * composed blocks can be layered on later as extra `MockupSpec`s; they
 * must use the same local-ref + descendants rules as `heroui`.)
 */

import type { FrameworkAdapter, MockupSpec } from './adapter.ts';
import { heroUIAdapter } from './heroui/index.ts';

export const heroUIProAdapter: FrameworkAdapter = {
  id: 'heroui-pro',
  title: 'HeroUI Pro',
  description:
    'HeroUI v3 design language + Pro composed blocks & templates. ' +
    'Reuses v3 tokens, components, and mockups.',
  reference: 'https://heroui.pro',

  tokens: () => heroUIAdapter.tokens(),
  components: () => heroUIAdapter.components(),
  mockups: (): MockupSpec[] => heroUIAdapter.mockups?.() ?? [],
  notes: (): string[] => [
    ...(heroUIAdapter.notes?.() ?? []),
    'heroui-pro currently reuses the heroui v3 token + component + mockup set.',
  ],
};
