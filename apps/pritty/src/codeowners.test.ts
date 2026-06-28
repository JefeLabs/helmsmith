import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findCodeowners, parseCodeowners, resolveReviewers } from './codeowners.js';

describe('findCodeowners', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pritty-codeowners-test-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when no CODEOWNERS file exists', () => {
    expect(findCodeowners(tmp)).toBeNull();
  });

  it('finds .github/CODEOWNERS (highest priority)', () => {
    mkdirSync(join(tmp, '.github'), { recursive: true });
    writeFileSync(join(tmp, '.github/CODEOWNERS'), '* @owner');
    expect(findCodeowners(tmp)).toBe('* @owner');
  });

  it('falls back to repo-root CODEOWNERS', () => {
    writeFileSync(join(tmp, 'CODEOWNERS'), '* @root-owner');
    expect(findCodeowners(tmp)).toBe('* @root-owner');
  });

  it('falls back to docs/CODEOWNERS', () => {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs/CODEOWNERS'), '* @docs-owner');
    expect(findCodeowners(tmp)).toBe('* @docs-owner');
  });
});

describe('parseCodeowners', () => {
  it('parses basic patterns and owners', () => {
    const rules = parseCodeowners(`
* @org/all
*.ts @typescript-team
src/api/ @api-team @backend-team
    `);
    expect(rules).toHaveLength(3);
    expect(rules[0]).toEqual({ pattern: '*', owners: ['@org/all'] });
    expect(rules[1]).toEqual({
      pattern: '*.ts',
      owners: ['@typescript-team'],
    });
    expect(rules[2]).toEqual({
      pattern: 'src/api/',
      owners: ['@api-team', '@backend-team'],
    });
  });

  it('ignores comments and blank lines', () => {
    const rules = parseCodeowners(`
# This is a comment
* @owner

# Another comment
src/ @src-team    # inline comment
    `);
    expect(rules).toHaveLength(2);
    expect(rules[0].pattern).toBe('*');
    expect(rules[1].pattern).toBe('src/');
  });

  it('skips lines without owners', () => {
    const rules = parseCodeowners(`
src/legacy/    # explicitly unowned, no owners specified
* @owner
    `);
    expect(rules).toHaveLength(1);
    expect(rules[0].pattern).toBe('*');
  });
});

describe('resolveReviewers', () => {
  it('matches files against patterns and dedupes owners', () => {
    const rules = parseCodeowners(`
*.ts @ts-user
src/ @src-user
    `);
    const result = resolveReviewers(['src/foo.ts', 'src/bar.ts', 'lib/baz.ts'], rules);
    // src/foo.ts: matches *.ts then src/ — last wins → src-user
    // src/bar.ts: same → src-user
    // lib/baz.ts: matches *.ts → ts-user
    // Bare `@name` owners parse as users, not teams.
    expect(result.users.sort()).toEqual(['src-user', 'ts-user']);
    expect(result.teams).toEqual([]);
  });

  it('respects last-match-wins (CODEOWNERS convention)', () => {
    const rules = parseCodeowners(`
* @first
*.ts @second
    `);
    const result = resolveReviewers(['foo.ts'], rules);
    // foo.ts matches both rules; last wins → second
    expect(result.teams.length + result.users.length).toBe(1);
    expect(result.users).toContain('second');
  });

  it('splits @org/team into team_reviewers', () => {
    const rules = parseCodeowners('* @myorg/backend-team @user1');
    const result = resolveReviewers(['anything.ts'], rules);
    expect(result.users).toEqual(['user1']);
    expect(result.teams).toEqual(['backend-team']);
  });

  it('returns empty when no patterns match', () => {
    const rules = parseCodeowners('docs/ @docs-team');
    const result = resolveReviewers(['src/foo.ts'], rules);
    expect(result.users).toEqual([]);
    expect(result.teams).toEqual([]);
  });

  it('ignores email-only owners (no @ prefix)', () => {
    const rules = parseCodeowners('* user@example.com @real-user');
    const result = resolveReviewers(['foo.ts'], rules);
    expect(result.users).toEqual(['real-user']);
  });

  it('matches no-slash patterns at any depth (gitignore convention)', () => {
    const rules = parseCodeowners('*.md @org/docs-team');
    const result = resolveReviewers(['README.md', 'docs/intro.md', 'src/notes/quick.md'], rules);
    expect(result.teams).toEqual(['docs-team']);
  });

  it('matches root-relative patterns starting with /', () => {
    const rules = parseCodeowners('/Makefile @org/build-team');
    const root = resolveReviewers(['Makefile'], rules);
    expect(root.teams).toEqual(['build-team']);
    const nested = resolveReviewers(['sub/Makefile'], rules);
    expect(nested.teams).toEqual([]);
  });

  it('matches trailing-slash patterns as directory recursion', () => {
    const rules = parseCodeowners('src/api/ @org/api-team');
    const result = resolveReviewers(['src/api/users.ts', 'src/api/auth/login.ts'], rules);
    expect(result.teams).toEqual(['api-team']);
  });
});
