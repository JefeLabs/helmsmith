import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { commonsTouched, expandScopes, globsOverlap, pathsMatching } from './scopes.js';
import { minimal } from './testing/manifests.js';

const m = validateManifest({
  ...minimal,
  scopes: {
    frontend: [
      'app-ui/app/{group}/{section}/**',
      'app-ui/components/{group}/{section}/**',
      'app-ui/app/api/{section}/**',
    ],
    backend: ['svc/modules/{module}/**'],
  },
  areas: {
    'shop/cart': { module: 'cart', extraScopes: ['docs/cart/**'] },
    'shop/team': { module: 'team' },
    'platform/auth': { commons: ['auth'] },
  },
  commons: { auth: ['app-ui/app/api/auth/**'], core: ['app-ui/components/core/**'] },
});

describe('scopes', () => {
  it('expands templates from the area path and module; fullstack adds backend', () => {
    expect(expandScopes(m, 'shop/cart', 'frontend')).toEqual([
      'app-ui/app/shop/cart/**',
      'app-ui/components/shop/cart/**',
      'app-ui/app/api/cart/**',
      'docs/cart/**',
    ]);
    expect(expandScopes(m, 'shop/cart', 'fullstack')).toContain('svc/modules/cart/**');
  });
  it('refuses fullstack on an area without a module, and an unknown area', () => {
    expect(() => expandScopes(m, 'platform/auth', 'fullstack')).toThrow(/module/);
    expect(() => expandScopes(m, 'nope/x', 'frontend')).toThrow(/AREA_UNKNOWN|unknown area/i);
  });
  it('finds overlap by literal prefix, in either direction', () => {
    expect(globsOverlap(['app-ui/app/shop/cart/**'], ['app-ui/app/shop/cart/checkout/**'])).toEqual(
      ['app-ui/app/shop/cart/** ~ app-ui/app/shop/cart/checkout/**'],
    );
    expect(globsOverlap(['app-ui/app/shop/cart/**'], ['app-ui/app/shop/team/**'])).toEqual([]);
  });
  it('matches paths against globs and names the commons touched', () => {
    expect(
      pathsMatching(['app-ui/app/shop/cart/page.tsx', 'README.md'], ['app-ui/app/shop/cart/**']),
    ).toEqual(['app-ui/app/shop/cart/page.tsx']);
    expect(commonsTouched(m, ['app-ui/components/core/Button.tsx', 'x.ts'])).toEqual(['core']);
  });
});
