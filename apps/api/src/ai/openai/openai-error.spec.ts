import { describe, expect, it } from '@jest/globals';
import { APIConnectionError, APIError, APIUserAbortError } from 'openai';

import {
  AiAuthenticationError,
  AiCancelledError,
  AiContextLengthError,
  AiRateLimitError,
  AiUnavailableError,
} from '../ai.errors';

import { toAiError } from './openai-error';

function apiError(
  status: number,
  message = 'boom',
  headers?: Headers,
): APIError {
  return new APIError(status, { message }, message, headers);
}

describe('toAiError', () => {
  it.each([
    [401, AiAuthenticationError],
    [403, AiAuthenticationError],
    [429, AiRateLimitError],
    [500, AiUnavailableError],
    [503, AiUnavailableError],
  ])('maps %i to the matching domain error', (status, expected) => {
    expect(toAiError(apiError(status))).toBeInstanceOf(expected);
  });

  it('recognises a context length failure among other 400s', () => {
    expect(
      toAiError(apiError(400, "This model's maximum context length is 8192")),
    ).toBeInstanceOf(AiContextLengthError);
  });

  it('does not mistake an ordinary 400 for a context length failure', () => {
    expect(toAiError(apiError(400, 'unknown model'))).toBeInstanceOf(
      AiUnavailableError,
    );
  });

  it('reads retry-after so a caller can back off sensibly', () => {
    const error = toAiError(
      apiError(429, 'slow down', new Headers({ 'retry-after': '30' })),
    );

    expect(error).toBeInstanceOf(AiRateLimitError);
    expect((error as AiRateLimitError).retryAfterMs).toBe(30_000);
  });

  it('tolerates a rate limit with no retry-after header', () => {
    expect((toAiError(apiError(429)) as AiRateLimitError).retryAfterMs).toBeNull();
  });

  it('treats a client abort as cancellation, not failure', () => {
    expect(toAiError(new APIUserAbortError())).toBeInstanceOf(AiCancelledError);
  });

  it('treats an unreachable provider as unavailable', () => {
    expect(
      toAiError(new APIConnectionError({ message: 'ECONNREFUSED' })),
    ).toBeInstanceOf(AiUnavailableError);
  });

  it('never lets a non-SDK throwable escape untranslated', () => {
    expect(toAiError(new Error('something else'))).toBeInstanceOf(
      AiUnavailableError,
    );
    expect(toAiError('a string')).toBeInstanceOf(AiUnavailableError);
  });

  it('passes an already-translated error through unchanged', () => {
    const original = new AiContextLengthError();

    expect(toAiError(original)).toBe(original);
  });
});
