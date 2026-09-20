import { describe, expect, it } from '@jest/globals';

import type { Environment } from '../../config/environment';

import { resolveEndpoint } from './openai-client';

const BASE: Environment = {
  NODE_ENV: 'test',
  PORT: 3000,
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable',
  SUPABASE_SECRET_KEY: undefined,
  WEB_ORIGINS: ['http://localhost:3001'],
  AI_BASE_URL: 'https://api.openai.com/v1',
  AI_API_KEY: 'shared-key',
  AI_CHAT_MODEL: 'gpt-4o-mini',
  AI_CHAT_BASE_URL: undefined,
  AI_CHAT_API_KEY: undefined,
  AI_EMBEDDING_MODEL: 'text-embedding-3-small',
  AI_EMBEDDING_BASE_URL: undefined,
  AI_EMBEDDING_API_KEY: undefined,
  AI_EMBEDDING_DIMENSIONS: undefined,
  AI_EMBEDDING_BATCH_SIZE: 96,
  AI_REQUEST_TIMEOUT_MS: 60_000,
  AI_MAX_RETRIES: 2,
};

describe('resolveEndpoint', () => {
  it('uses the shared endpoint for both roles by default', () => {
    expect(resolveEndpoint(BASE, 'chat').baseURL).toBe(BASE.AI_BASE_URL);
    expect(resolveEndpoint(BASE, 'embedding').baseURL).toBe(BASE.AI_BASE_URL);
  });

  // The point of the whole abstraction: switching provider is configuration.
  it('switches provider without touching application code', () => {
    const groq: Environment = {
      ...BASE,
      AI_BASE_URL: 'https://api.groq.com/openai/v1',
      AI_API_KEY: 'gsk-key',
      AI_CHAT_MODEL: 'llama-3.3-70b-versatile',
    };

    expect(resolveEndpoint(groq, 'chat')).toMatchObject({
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk-key',
    });
  });

  it('lets chat and embeddings live on different services', () => {
    const split: Environment = {
      ...BASE,
      AI_BASE_URL: 'https://api.groq.com/openai/v1',
      AI_API_KEY: 'gsk-key',
      AI_EMBEDDING_BASE_URL: 'http://localhost:11434/v1',
      AI_EMBEDDING_API_KEY: undefined,
    };

    expect(resolveEndpoint(split, 'chat').baseURL).toBe(
      'https://api.groq.com/openai/v1',
    );
    expect(resolveEndpoint(split, 'embedding').baseURL).toBe(
      'http://localhost:11434/v1',
    );
  });

  it('prefers a role-specific key over the shared one', () => {
    const split: Environment = { ...BASE, AI_CHAT_API_KEY: 'chat-only-key' };

    expect(resolveEndpoint(split, 'chat').apiKey).toBe('chat-only-key');
    expect(resolveEndpoint(split, 'embedding').apiKey).toBe('shared-key');
  });

  // Ollama needs no credentials, but the SDK insists on a non-empty value.
  it('substitutes a placeholder when the provider needs no key', () => {
    const ollama: Environment = {
      ...BASE,
      AI_BASE_URL: 'http://localhost:11434/v1',
      AI_API_KEY: undefined,
    };

    expect(resolveEndpoint(ollama, 'chat').apiKey).toBeTruthy();
  });

  it('carries timeout and retry policy onto every endpoint', () => {
    const tuned: Environment = {
      ...BASE,
      AI_REQUEST_TIMEOUT_MS: 5_000,
      AI_MAX_RETRIES: 0,
    };

    expect(resolveEndpoint(tuned, 'chat')).toMatchObject({
      timeout: 5_000,
      maxRetries: 0,
    });
  });
});
