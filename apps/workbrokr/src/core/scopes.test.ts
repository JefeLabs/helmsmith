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
  it('supports backend mode and mode-specific extraScopes + sharedScopes', () => {
    const m2 = validateManifest({
      ...minimal,
      scopes: {
        frontend: ['app-ui/app/{group}/{section}/**'],
        backend: ['svc/modules/{module}/**', 'db/migration/*{module}*'],
      },
      areas: {
        'org/dashboard': {
          module: 'dashboard',
          extraScopes: { frontend: ['app-ui/widgets/org/**'], backend: ['svc/common/dash/**'] },
          sharedScopes: ['app-ui/components/discover-schools/dashboards/**'],
        },
        'family/dashboard': {
          module: 'family_dashboard',
          sharedScopes: ['app-ui/components/discover-schools/dashboards/**'],
        },
      },
    });
    expect(expandScopes(m2, 'org/dashboard', 'backend')).toEqual([
      'svc/modules/dashboard/**',
      'db/migration/*dashboard*',
      'svc/common/dash/**',
    ]);
    expect(expandScopes(m2, 'org/dashboard', 'frontend')).toEqual([
      'app-ui/app/org/dashboard/**',
      'app-ui/widgets/org/**',
    ]);
    expect(
      globsOverlap(
        expandScopes(m2, 'org/dashboard', 'frontend'),
        expandScopes(m2, 'family/dashboard', 'frontend'),
      ),
    ).toEqual([]);
  });
  it('compares globs by path segment so school vs schoolscandidates and distinct *module* globs do not collide', () => {
    expect(
      globsOverlap(['app-service/modules/school/**'], ['app-service/modules/schoolscandidates/**']),
    ).toEqual([]);
    expect(
      globsOverlap(['db/migration/*registration_students*'], ['db/migration/*team*']),
    ).toEqual([]);
    expect(
      globsOverlap(['db/migration/*team*'], ['db/migration/*team*']),
    ).toEqual(['db/migration/*team* ~ db/migration/*team*']);
  });
  it('narrows scopes when --task and --scope are passed, and refuses invalid narrowing', () => {
    expect(() =>
      expandScopes(m, 'shop/cart', 'frontend', ['app-ui/app/shop/cart/SearchInput/**'], false),
    ).toThrow(/SCOPE_REQUIRES_TASK|--task/);
    expect(
      expandScopes(m, 'shop/cart', 'frontend', ['app-ui/app/shop/cart/SearchInput/**'], true),
    ).toEqual(['app-ui/app/shop/cart/SearchInput/**']);
    expect(() =>
      expandScopes(m, 'shop/cart', 'frontend', ['app-ui/app/shop/team/**'], true),
    ).toThrow(/outside|SCOPE_OUTSIDE_AREA/i);
  });
});
