import OpenAI from 'openai';

import type { Environment } from '../../config/environment';

/**
 * A provider that requires no credentials still needs the SDK to be handed
 * something, so a local Ollama gets this rather than a configuration error.
 */
const PLACEHOLDER_API_KEY = 'no-key-required';

export interface OpenAiEndpoint {
  baseURL: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

/**
 * Resolves the endpoint for one role, falling back to the shared settings.
 *
 * The fallback is what keeps the common case to two variables while still
 * allowing chat and embeddings to live on different services.
 */
export function resolveEndpoint(
  environment: Environment,
  role: 'chat' | 'embedding',
): OpenAiEndpoint {
  const baseURL =
    role === 'chat'
      ? (environment.AI_CHAT_BASE_URL ?? environment.AI_BASE_URL)
      : (environment.AI_EMBEDDING_BASE_URL ?? environment.AI_BASE_URL);

  const apiKey =
    role === 'chat'
      ? (environment.AI_CHAT_API_KEY ?? environment.AI_API_KEY)
      : (environment.AI_EMBEDDING_API_KEY ?? environment.AI_API_KEY);

  return {
    baseURL,
    apiKey: apiKey ?? PLACEHOLDER_API_KEY,
    timeout: environment.AI_REQUEST_TIMEOUT_MS,
    maxRetries: environment.AI_MAX_RETRIES,
  };
}

export function createOpenAiClient(endpoint: OpenAiEndpoint): OpenAI {
  return new OpenAI({
    baseURL: endpoint.baseURL,
    apiKey: endpoint.apiKey,
    timeout: endpoint.timeout,
    maxRetries: endpoint.maxRetries,
  });
}
