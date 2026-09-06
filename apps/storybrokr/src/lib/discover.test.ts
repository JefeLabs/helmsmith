// src/lib/discover.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverStories } from './discover.js';
import { StorybrokrError } from './errors.js';

/** Write a tree of files; keys are paths relative to the root. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'sb-disc-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const PATHS = { '@/*': ['./src/*', './*'], '@core/*': ['./components/core/*'] };

describe('discoverStories', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it('walks relative and alias imports transitively and keeps only story-bearing modules', () => {
    const root = tree({
      'components/core/organisms/calendar/section/CalendarSection.tsx':
        "import { CalendarHeader } from '../molecules/CalendarHeader/CalendarHeader';\nimport { Switch } from '@core/atoms/switch/Switch';\nimport { fmt } from '../utils/fmt';\nexport const CalendarSection = () => null;\n",
      'components/core/organisms/calendar/section/CalendarSection.stories.tsx':
        'export default {};\n',
      'components/core/organisms/calendar/section/CalendarSection.types.ts':
        'export type P = {};\n',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.tsx':
        "import { CalendarViewTab } from '@core/atoms/CalendarViewTab/CalendarViewTab';\nexport const CalendarHeader = () => null;\n",
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.stories.tsx': '',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeaderWithTabs.stories.tsx':
        '',
      'components/core/organisms/calendar/utils/fmt.ts': 'export const fmt = () => 1;\n',
      'components/core/atoms/switch/Switch.tsx': 'export const Switch = () => null;\n',
      'components/core/atoms/switch/Switch.stories.tsx': '',
      'components/core/atoms/CalendarViewTab/CalendarViewTab.tsx':
        'export const CalendarViewTab = () => null;\n',
      'components/core/atoms/CalendarViewTab/CalendarViewTab.stories.tsx': '',
      'components/core/atoms/Unrelated/Unrelated.stories.tsx': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'components/core/organisms/calendar/section', PATHS);
    expect(result.storyFiles).toEqual([
      'components/core/atoms/CalendarViewTab/CalendarViewTab.stories.tsx',
      'components/core/atoms/switch/Switch.stories.tsx',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeader.stories.tsx',
      'components/core/organisms/calendar/molecules/CalendarHeader/CalendarHeaderWithTabs.stories.tsx',
      'components/core/organisms/calendar/section/CalendarSection.stories.tsx',
    ]);
    expect(result.unresolved).toEqual([]);
    expect(result.modulesVisited).toBeGreaterThanOrEqual(5);
  });

  it('accepts a single story file as the component', () => {
    const root = tree({
      'src/Button.tsx': "import './Icon';\nexport const Button = () => null;\n",
      'src/Button.stories.tsx': '',
      'src/Icon.tsx': 'export const Icon = () => null;\n',
      'src/Icon.stories.tsx': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'src/Button.stories.tsx', {});
    expect(result.storyFiles).toEqual(['src/Button.stories.tsx']);
  });

  it('resolves index files, dynamic imports, and survives cycles', () => {
    const root = tree({
      'src/a/index.ts': "export * from './A';\n",
      'src/a/A.tsx': "import('../b');\nimport { B } from '../b';\nexport const A = () => null;\n",
      'src/a/A.stories.tsx': '',
      'src/b/index.ts': "import { A } from '../a';\nexport const B = () => null;\n",
      'src/b/index.stories.tsx': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'src/a', {});
    expect(result.storyFiles).toEqual(['src/a/A.stories.tsx', 'src/b/index.stories.tsx']);
  });

  it('logs unresolvable local specifiers without throwing and never enters node_modules', () => {
    const root = tree({
      'src/C.tsx':
        "import x from './missing';\nimport react from 'react';\nexport const C = () => null;\n",
      'src/C.stories.tsx': '',
      'node_modules/react/index.js': '',
      'node_modules/react/index.stories.js': '',
    });
    roots.push(root);
    const result = discoverStories(root, 'src', {});
    expect(result.storyFiles).toEqual(['src/C.stories.tsx']);
    expect(result.unresolved).toEqual(['src/C.tsx -> ./missing']);
  });

  it('throws COMPONENT_NOT_FOUND for a missing path or a path with no reachable stories', () => {
    const root = tree({ 'src/plain.ts': 'export const x = 1;\n' });
    roots.push(root);
    expect(() => discoverStories(root, 'src/nope', {})).toThrow(StorybrokrError);
    try {
      discoverStories(root, 'src', {});
    } catch (e) {
      expect((e as StorybrokrError).code).toBe('COMPONENT_NOT_FOUND');
    }
  });
});
