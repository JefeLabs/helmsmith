import { describe, expect, it } from 'vitest';
import { excludeBots, isBotAuthor } from '../aggregator/bots.js';

const PATTERNS = ['[bot]', 'dependabot', 'renovate', 'github-actions'];

describe('isBotAuthor', () => {
  it('matches case-insensitively on name or email', () => {
    expect(
      isBotAuthor('dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com', PATTERNS),
    ).toBe(true);
    expect(isBotAuthor('Renovate Bot', 'bot@renovateapp.com', PATTERNS)).toBe(true);
    expect(isBotAuthor('GitHub Actions', 'github-actions@github.com', PATTERNS)).toBe(true);
    expect(isBotAuthor('Alice Chen', 'alice@co.com', PATTERNS)).toBe(false);
  });
  it('treats an empty pattern list as "no bots"', () => {
    expect(isBotAuthor('dependabot[bot]', 'x@y', [])).toBe(false);
  });
});

describe('excludeBots', () => {
  it('drops records whose member or email matches', () => {
    const recs = [
      { member: 'Alice', email: 'alice@co.com' },
      { member: 'dependabot[bot]', email: 'd@x' },
      { member: 'CI', email: 'github-actions@github.com' },
    ];
    expect(excludeBots(recs, PATTERNS).map((r) => r.member)).toEqual(['Alice']);
  });
});
