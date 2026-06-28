import { describe, expect, it } from 'vitest';
import {
  categorize,
  DEFAULT_CATEGORIES,
  mergeCategories,
  UNKNOWN_CATEGORY,
} from './categorizer.js';

describe('categorize', () => {
  it('groups files into the default categories', () => {
    const files = [
      'src/index.ts',
      'tests/unit/foo.test.ts',
      'Dockerfile',
      '.storybook/main.ts',
      'package.json',
      'random.txt',
    ];
    const result = categorize(files);
    expect(result.app).toContain('src/index.ts');
    expect(result.test).toContain('tests/unit/foo.test.ts');
    expect(result.infra).toContain('Dockerfile');
    expect(result.storybook).toContain('.storybook/main.ts');
    expect(result.config).toContain('package.json');
    expect(result[UNKNOWN_CATEGORY]).toContain('random.txt');
  });

  it('first-match-wins — order in CategoryMap matters', () => {
    // src/foo.test.ts matches both `app` (src/**) and `test` (**/*.test.*).
    // Defaults order: app first, then test → so src/foo.test.ts → app.
    // That's actually wrong for typical repos; users override by putting
    // their custom `test` ahead of `app` in their config.
    const result = categorize(['src/foo.test.ts']);
    expect(result.app).toContain('src/foo.test.ts');
    expect(result.test).not.toContain('src/foo.test.ts');
  });

  it('user-ordered categories let test win over app', () => {
    const customOrder = {
      test: ['**/*.test.*'],
      app: ['src/**'],
    };
    const result = categorize(['src/foo.test.ts'], customOrder);
    expect(result.test).toContain('src/foo.test.ts');
    expect(result.app).not.toContain('src/foo.test.ts');
  });

  it('creates empty buckets for every configured category', () => {
    const result = categorize([]);
    for (const name of Object.keys(DEFAULT_CATEGORIES)) {
      expect(result[name]).toEqual([]);
    }
    expect(result[UNKNOWN_CATEGORY]).toEqual([]);
  });

  it('matches dotfiles via the dot:true option', () => {
    const result = categorize(['.github/workflows/ci.yml']);
    expect(result.infra).toContain('.github/workflows/ci.yml');
  });
});

describe('mergeCategories', () => {
  it('returns defaults when user is undefined', () => {
    expect(mergeCategories(undefined)).toBe(DEFAULT_CATEGORIES);
  });

  it('user entries replace same-key defaults', () => {
    const merged = mergeCategories({ app: ['custom/**'] });
    expect(merged.app).toEqual(['custom/**']);
    // Other defaults preserved
    expect(merged.test).toEqual(DEFAULT_CATEGORIES.test);
  });

  it('user-only categories add new buckets', () => {
    const merged = mergeCategories({ docs: ['docs/**'] });
    expect(merged.docs).toEqual(['docs/**']);
    expect(merged.app).toEqual(DEFAULT_CATEGORIES.app);
  });
});
