import { describe, expect, it } from 'vitest';
import { parseGitHubRemote } from './git.js';

describe('parseGitHubRemote', () => {
  it('parses HTTPS form with .git suffix', () => {
    expect(parseGitHubRemote('https://github.com/ecruz165/agentx-toolbox.git')).toEqual({
      owner: 'ecruz165',
      repo: 'agentx-toolbox',
    });
  });

  it('parses HTTPS form without .git suffix', () => {
    expect(parseGitHubRemote('https://github.com/ecruz165/agentx-toolbox')).toEqual({
      owner: 'ecruz165',
      repo: 'agentx-toolbox',
    });
  });

  it('parses HTTPS form with trailing slash', () => {
    expect(parseGitHubRemote('https://github.com/ecruz165/agentx-toolbox/')).toEqual({
      owner: 'ecruz165',
      repo: 'agentx-toolbox',
    });
  });

  it('parses SSH form', () => {
    expect(parseGitHubRemote('git@github.com:ecruz165/agentx-toolbox.git')).toEqual({
      owner: 'ecruz165',
      repo: 'agentx-toolbox',
    });
  });

  it('parses SSH form without .git', () => {
    expect(parseGitHubRemote('git@github.com:ecruz165/agentx-toolbox')).toEqual({
      owner: 'ecruz165',
      repo: 'agentx-toolbox',
    });
  });

  it('returns null for non-GitHub URLs', () => {
    expect(parseGitHubRemote('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGitHubRemote('https://example.com/foo/bar')).toBeNull();
    expect(parseGitHubRemote('not-a-url')).toBeNull();
  });

  it('handles repo names with hyphens and dots', () => {
    expect(parseGitHubRemote('git@github.com:org/some-repo.name.git')).toEqual({
      owner: 'org',
      repo: 'some-repo.name',
    });
  });
});

describe('parseGitHubRemote on the URL shapes real checkouts use', () => {
  it('accepts a token in the URL userinfo, ssh:// URLs and SSH host aliases', () => {
    expect(parseGitHubRemote('https://x-access-token:ghs_abc@github.com/o/r.git')).toEqual({
      owner: 'o',
      repo: 'r',
    });
    expect(parseGitHubRemote('ssh://git@github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseGitHubRemote('ssh://git@github.com:22/o/r')).toEqual({ owner: 'o', repo: 'r' });
    expect(parseGitHubRemote('git@github.com-work:o/r.git')).toEqual({ owner: 'o', repo: 'r' });
  });
});

describe('describeRemote', () => {
  it('never shows credentials embedded in a remote URL', async () => {
    const { describeRemote } = await import('./git.js');
    expect(describeRemote('https://x-access-token:ghs_abc@github.com/o/r.git')).toBe(
      'https://***@github.com/o/r.git',
    );
    expect(describeRemote('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
    expect(describeRemote('https://github.com/o/r.git?access_token=abc')).not.toContain('abc');
    expect(describeRemote('https://user:pw@github.com/o/r')).not.toContain('pw');
  });
});
