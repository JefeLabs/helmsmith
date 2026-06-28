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
