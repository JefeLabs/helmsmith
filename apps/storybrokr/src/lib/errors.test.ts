import { describe, expect, it } from 'vitest';
import { httpStatusFor, StorybrokrError, toErrorBody } from './errors.js';

describe('StorybrokrError', () => {
  it('maps every code from the spec table to its HTTP status', () => {
    expect(httpStatusFor('HOST_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('HOST_INVALID')).toBe(422);
    expect(httpStatusFor('COMPONENT_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('INSTANCE_CAP_REACHED')).toBe(429);
    expect(httpStatusFor('NO_FREE_PORT')).toBe(503);
    expect(httpStatusFor('BOOT_FAILED')).toBe(502);
    expect(httpStatusFor('BOOT_TIMEOUT')).toBe(504);
    expect(httpStatusFor('INSTANCE_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('DAEMON_UNAVAILABLE')).toBe(503);
  });

  it('carries code, status and an optional log tail', () => {
    const err = new StorybrokrError('BOOT_FAILED', 'storybook exited with code 1', [
      'line a',
      'line b',
    ]);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('BOOT_FAILED');
    expect(err.status).toBe(502);
    expect(err.logTail).toEqual(['line a', 'line b']);
    expect(err.message).toBe('storybook exited with code 1');
  });

  it('serializes itself and wraps foreign errors as INTERNAL', () => {
    expect(toErrorBody(new StorybrokrError('NO_FREE_PORT', 'range exhausted'))).toEqual({
      code: 'NO_FREE_PORT',
      message: 'range exhausted',
    });
    expect(toErrorBody(new TypeError('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
    expect(toErrorBody('nope')).toEqual({ code: 'INTERNAL', message: 'nope' });
  });
});
