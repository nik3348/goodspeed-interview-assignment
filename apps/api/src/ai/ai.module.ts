import { Global, Logger, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { EMBEDDING_DIMENSIONS } from '@repo/database';

import { ENVIRONMENT, type Environment } from '../config/environment';

import { AiExceptionFilter } from './ai-exception.filter';
import { AiConfigurationError } from './ai.errors';
import { CHAT_MODEL, type ChatModel } from './chat-model';
import { EMBEDDING_MODEL, type EmbeddingModel } from './embedding-model';
import { OpenAiChatModel } from './openai/openai-chat-model';
import { createOpenAiClient, resolveEndpoint } from './openai/openai-client';
import { OpenAiEmbeddingModel } from './openai/openai-embedding-model';

/**
 * Binds the configured provider to the `ChatModel` and `EmbeddingModel`
 * interfaces.
 *
 * This module is the single seam where a provider is chosen. Everything
 * downstream injects the interfaces, so supporting a service that does *not*
 * speak the OpenAI format means adding an adapter and one branch here — no
 * caller changes.
 */
@Global()
@Module({
  providers: [
    {
      provide: CHAT_MODEL,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): ChatModel => {
        const endpoint = resolveEndpoint(environment, 'chat');

        new Logger(AiModule.name).log(
          `Chat: ${environment.AI_CHAT_MODEL} via ${endpoint.baseURL}`,
        );

        return new OpenAiChatModel(
          createOpenAiClient(endpoint),
          environment.AI_CHAT_MODEL,
        );
      },
    },
    {
      provide: EMBEDDING_MODEL,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): EmbeddingModel => {
        const endpoint = resolveEndpoint(environment, 'embedding');
        const requested = environment.AI_EMBEDDING_DIMENSIONS;

        // The pgvector column is a fixed width. Catching a mismatch here beats
        // discovering it when the first document fails to index.
        if (requested !== undefined && requested !== EMBEDDING_DIMENSIONS) {
          throw new AiConfigurationError(
            `AI_EMBEDDING_DIMENSIONS is ${requested}, but document_chunks.embedding ` +
              `stores ${EMBEDDING_DIMENSIONS}. Change the variable, or add a ` +
              'migration that alters the column and its index.',
          );
        }

        new Logger(AiModule.name).log(
          `Embeddings: ${environment.AI_EMBEDDING_MODEL} via ${endpoint.baseURL} ` +
            `(${EMBEDDING_DIMENSIONS}d)`,
        );

        return new OpenAiEmbeddingModel(
          createOpenAiClient(endpoint),
          environment.AI_EMBEDDING_MODEL,
          EMBEDDING_DIMENSIONS,
          environment.AI_EMBEDDING_BATCH_SIZE,
          requested !== undefined,
        );
      },
    },
    { provide: APP_FILTER, useClass: AiExceptionFilter },
  ],
  exports: [CHAT_MODEL, EMBEDDING_MODEL],
})
export class AiModule {}
