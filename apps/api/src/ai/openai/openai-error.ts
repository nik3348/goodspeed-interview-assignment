import { APIConnectionError, APIError, APIUserAbortError } from 'openai';

import {
  AiAuthenticationError,
  AiCancelledError,
  AiContextLengthError,
  AiError,
  AiRateLimitError,
  AiUnavailableError,
} from '../ai.errors';

/**
 * Translates an SDK failure into the domain's error vocabulary.
 *
 * OpenAI-compatible providers agree on status codes far more reliably than on
 * error bodies, so the status is the primary signal and the body is only
 * consulted to separate "prompt too long" from other 400s.
 */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) {
    return error;
  }

  if (error instanceof APIUserAbortError) {
    return new AiCancelledError(error);
  }

  if (error instanceof APIConnectionError) {
    return new AiUnavailableError(error);
  }

  if (error instanceof APIError) {
    switch (error.status) {
      case 401:
      case 403:
        return new AiAuthenticationError(error);

      case 429:
        return new AiRateLimitError(retryAfterMs(error), error);

      case 400:
      case 422:
        return isContextLengthError(error)
          ? new AiContextLengthError(error)
          : new AiUnavailableError(error);

      case 500:
      case 502:
      case 503:
      case 504:
        return new AiUnavailableError(error);

      default:
        return new AiUnavailableError(error);
    }
  }

  return new AiUnavailableError(error);
}

function isContextLengthError(error: APIError): boolean {
  const code = typeof error.code === 'string' ? error.code : '';
  const haystack = `${code} ${error.message}`.toLowerCase();

  // Providers word this differently; these substrings cover the common ones.
  return (
    haystack.includes('context_length') ||
    haystack.includes('context length') ||
    haystack.includes('too many tokens') ||
    haystack.includes('maximum context')
  );
}

function retryAfterMs(error: APIError): number | null {
  const header = error.headers?.get?.('retry-after');
  const seconds =
    header === undefined || header === null ? NaN : Number(header);

  return Number.isFinite(seconds) ? seconds * 1000 : null;
}
