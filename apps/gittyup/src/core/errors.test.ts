import { describe, expect, it } from 'vitest';
import { exitCodeFor, GittyupError, toErrorBody } from './errors.js';

describe('exitCodeFor', () => {
  it.each([
    'USAGE',
    'CONFIRMATION_REQUIRED',
    'INTERACTIVE_ONLY',
    'TARGET_REQUIRED',
    'TARGET_UNKNOWN',
    'GROUP_EXISTS',
    'GROUP_NOT_FOUND',
    'REPO_EXISTS',
    'REPO_NOT_FOUND',
    'PATH_NOT_FOUND',
    'MANIFEST_INVALID',
    'AUTH_REQUIRED',
  ] as const)('%s is a refusal (2)', (code) => expect(exitCodeFor(code)).toBe(2));

  it.each(['GIT_FAILED', 'GITHUB_FAILED', 'INTERNAL'] as const)('%s is broken (1)', (code) =>
    expect(exitCodeFor(code)).toBe(1),
  );
});

describe('toErrorBody', () => {
  it('keeps code, message and details of a GittyupError', () => {
    expect(
      toErrorBody(
        new GittyupError('TARGET_UNKNOWN', '"x" is not a known group or repo', { target: 'x' }),
      ),
    ).toStrictEqual({
      code: 'TARGET_UNKNOWN',
      message: '"x" is not a known group or repo',
      details: { target: 'x' },
    });
  });

  it('omits details when there are none', () => {
    expect(Object.keys(toErrorBody(new GittyupError('USAGE', 'bad')))).toEqual(['code', 'message']);
  });

  it('maps any other Error to INTERNAL', () =>
    expect(toErrorBody(new Error('boom'))).toStrictEqual({ code: 'INTERNAL', message: 'boom' }));

  it('maps a thrown non-Error to INTERNAL', () =>
    expect(toErrorBody('str')).toStrictEqual({ code: 'INTERNAL', message: 'str' }));
});
