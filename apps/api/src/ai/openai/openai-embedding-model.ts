import { Injectable } from '@nestjs/common';
import type OpenAI from 'openai';

import { AiConfigurationError } from '../ai.errors';
import type { EmbeddingModel } from '../embedding-model';
import type {
  EmbeddingRequest,
  EmbeddingResult,
  TokenUsage,
} from '../messages';

import { toAiError } from './openai-error';

/**
 * An embedding model reached over the OpenAI wire format.
 *
 * Two things this adapter owns that callers should not have to think about:
 * splitting a large batch into requests the provider will accept, and checking
 * that the vectors coming back are the width the database column expects.
 */
@Injectable()
export class OpenAiEmbeddingModel implements EmbeddingModel {
  constructor(
    private readonly client: OpenAI,
    readonly model: string,
    readonly dimensions: number,
    readonly maxBatchSize: number,
    /**
     * Whether to ask the provider for a specific width. OpenAI's
     * text-embedding-3-* family honours this by truncating; providers that do
     * not support it reject the parameter, so it is only sent when the
     * deployment explicitly configured a width.
     */
    private readonly requestDimensions: boolean,
  ) {}

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    if (request.inputs.length === 0) {
      return { embeddings: [], usage: null };
    }

    const embeddings: number[][] = [];
    let usage: TokenUsage | null = null;

    for (const batch of chunked(request.inputs, this.maxBatchSize)) {
      const result = await this.embedBatch(batch, request.signal);

      embeddings.push(...result.embeddings);
      usage = addUsage(usage, result.usage);
    }

    return { embeddings, usage };
  }

  private async embedBatch(
    inputs: string[],
    signal: AbortSignal | undefined,
  ): Promise<EmbeddingResult> {
    let response;

    try {
      response = await this.client.embeddings.create(
        {
          model: this.model,
          input: inputs,
          ...(this.requestDimensions ? { dimensions: this.dimensions } : {}),
        },
        { signal },
      );
    } catch (error) {
      throw toAiError(error);
    }

    // The API contract says the order matches the input, but it also returns
    // an explicit index; sorting by it costs nothing and removes the doubt.
    const ordered = [...response.data].sort((a, b) => a.index - b.index);

    if (ordered.length !== inputs.length) {
      throw new AiConfigurationError(
        `${this.model} returned ${ordered.length} embeddings for ${inputs.length} inputs.`,
      );
    }

    for (const item of ordered) {
      if (item.embedding.length !== this.dimensions) {
        throw new AiConfigurationError(
          `${this.model} returned ${item.embedding.length}-dimensional vectors, ` +
            `but the database column stores ${this.dimensions}. Set ` +
            'AI_EMBEDDING_DIMENSIONS if the provider can truncate, or migrate ' +
            'the column to match the model.',
        );
      }
    }

    return {
      embeddings: ordered.map((item) => item.embedding),
      usage: toTokenUsage(response.usage),
    };
  }
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

function toTokenUsage(
  usage: OpenAI.CreateEmbeddingResponse.Usage | null | undefined,
): TokenUsage | null {
  if (!usage) {
    return null;
  }

  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: 0,
    totalTokens: usage.total_tokens ?? usage.prompt_tokens ?? 0,
  };
}

function addUsage(
  left: TokenUsage | null,
  right: TokenUsage | null,
): TokenUsage | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}
